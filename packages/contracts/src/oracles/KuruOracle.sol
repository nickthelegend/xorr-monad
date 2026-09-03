// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IXorrOracle} from "../interfaces/IXorrOracle.sol";
import {IKuruOrderBook} from "../interfaces/IKuruOrderBook.sol";
import {Owned} from "../lib/Auth.sol";

/// @title KuruOracle
/// @notice Prices a XORR market from Kuru's on-chain order book.
///
///         Every other oracle in this repo is a report of what happened somewhere else:
///         a keeper relaying an exchange, or an aggregation network signing a number.
///         This one reads the book directly. The mid it returns is the midpoint of real
///         resting orders on Monad's native CLOB at the current block — there is no
///         off-chain component, no relayer, and nothing to trust between the venue and
///         the settlement.
///
///         That makes the freshness question different too. A push feed can go stale
///         because the publisher stopped; an order book cannot, because reading it *is*
///         the observation. What it can do instead is go thin — one side empty, or a
///         spread so wide the midpoint is a number nobody would trade at. Those are the
///         conditions guarded here, and when they hold the oracle reports no price at
///         all rather than a plausible-looking one.
contract KuruOracle is IXorrOracle, Owned {
    uint8 public constant PRICE_DECIMALS = 8;
    /// @dev Kuru quotes bestBidAsk with 18 decimals; XORR settles on 8.
    uint256 internal constant SCALE_DOWN = 1e10;
    uint256 internal constant BPS = 10_000;
    /// @dev A side must rest at least this fraction of the depth floor for its size to
    ///      be weighted against the other. One twentieth of the floor, so dust cannot
    ///      set the mark but ordinary imbalance still can.
    uint256 internal constant MICRO_MIN_DEPTH_DIVISOR = 20;

    /// @notice How a book is turned into a single price.
    enum Mark {
        /// @dev Midpoint of best bid and best ask. Simple, and biased when the two
        ///      sides carry very different size.
        MID,
        /// @dev Size-weighted midpoint — the microprice. Leans toward the thinner side,
        ///      because that is the side a trade would push through first.
        MICRO
    }

    struct Book {
        IKuruOrderBook market;
        /// @dev Widest bid/ask spread, in bps of the mid, that still yields a price.
        uint32 maxSpreadBps;
        /// @dev How far either side of the mid counts toward the depth floor, in bps.
        uint32 depthBandBps;
        /// @dev Least base-asset size that must rest inside that band, in the market's
        ///      own size precision. Zero disables the floor.
        uint128 minDepth;
        /// @dev Ladder levels to inspect per side when measuring depth.
        uint8 depthLevels;
        Mark mark;
        bool enabled;
        /**
         * @dev Seconds of time-weighted average to settle on. Zero means settle on the
         *      instantaneous mark.
         *
         *      This is the answer to the only question that really matters about
         *      settling a derivative on an order book: what stops someone moving the
         *      book at the cutoff block. A spot mark is worth attacking for exactly one
         *      block. An average over the round means an attacker has to hold the book
         *      away from its true price for the whole round, against everyone else's
         *      resting orders, and pay the spread on the way in and out — which is not
         *      a guard against manipulation, it is a price for it.
         */
        uint32 twapWindow;
    }

    /**
     * @notice One reading of the mark, and the time-weighted sum up to it.
     * @dev Packed into a single slot: a timestamp good until 2106 and a cumulative
     *      large enough for a 1e18-scaled mark accumulating for centuries.
     */
    struct Obs {
        uint32 t;
        uint224 cum;
    }

    /// @dev How many readings each market keeps. At one poke per Monad block this is
    ///      roughly nine minutes of history, which covers every round the market sells
    ///      except the fifteen-minute one — and that one is long enough that a
    ///      cutoff-block attack on it is not the threat being defended against.
    uint16 public constant CARDINALITY = 1800;

    /// @dev How stale the newest reading may be before the average is refused.
    uint32 public constant MAX_OBS_AGE = 5;

    mapping(bytes32 => Book) public books;

    mapping(bytes32 => Obs[CARDINALITY]) internal _obs;
    /// @dev Index of the newest reading, and how many slots have ever been written.
    mapping(bytes32 => uint16) public obsIndex;
    mapping(bytes32 => uint16) public obsCount;

    event BookSet(bytes32 indexed marketId, address market, uint32 maxSpreadBps, bool enabled);
    event DepthFloorSet(bytes32 indexed marketId, uint32 bandBps, uint128 minDepth, uint8 levels);
    event MarkSet(bytes32 indexed marketId, Mark mark);
    event TwapWindowSet(bytes32 indexed marketId, uint32 seconds_);
    /**
     * @notice One recorded reading, with the book conditions it was taken under.
     * @dev Emitted on every poke rather than only at settlements, which makes the
     *      conditions of any settlement derivable from the pokes around its block —
     *      and makes the ones between settlements visible too. A receipt written only
     *      when it is needed is a receipt nobody can check against its neighbours.
     */
    event Poked(
        bytes32 indexed marketId,
        uint256 mark8,
        uint32 at,
        uint256 bid8,
        uint256 ask8,
        uint256 spreadBps,
        uint256 depthNearMid
    );

    error NoBook();
    error BadSpread();
    error NoMark();
    error WindowTooLong();

    constructor(address _owner) Owned(_owner) {}

    /// @param maxSpreadBps 0 disables the spread guard.
    function setBook(bytes32 marketId, address market, uint32 maxSpreadBps, bool enabled)
        external
        onlyOwner
    {
        Book storage b = books[marketId];
        b.market = IKuruOrderBook(market);
        b.maxSpreadBps = maxSpreadBps;
        b.enabled = enabled;
        emit BookSet(marketId, market, maxSpreadBps, enabled);
    }

    /**
     * @notice Choose how this book is marked.
     *
     * A midpoint treats both sides as equally informative. When one side rests two
     * orders of magnitude more size than the other — which the live MON book does —
     * that is plainly wrong: it takes almost nothing to clear the thin side, so fair
     * value sits much closer to it. The microprice weights each price by the size on
     * the OPPOSITE side, which is the standard correction and, on the current book,
     * moves the mark by nearly a hundred basis points.
     */
    /**
     * @notice Settle this market on a time-weighted average of the mark.
     * @param seconds_ Length of the window. Zero settles on the instantaneous mark.
     */
    function setTwapWindow(bytes32 marketId, uint32 seconds_) external onlyOwner {
        // A window longer than the buffer can hold is a window the oracle cannot honour.
        if (seconds_ > uint32(CARDINALITY) * 60) revert WindowTooLong();
        books[marketId].twapWindow = seconds_;
        emit TwapWindowSet(marketId, seconds_);
    }

    function setMark(bytes32 marketId, Mark mark) external onlyOwner {
        books[marketId].mark = mark;
        emit MarkSet(marketId, mark);
    }

    /**
     * @notice Require real size near the mid before this book may price a market.
     *
     * A spread guard catches a book that is quoted badly. It does not catch one that is
     * quoted tightly on almost nothing — a pair of dust orders a tick apart look
     * perfect by spread and would move several percent the moment anyone touched them.
     * Settling a derivative on that midpoint means settling on a price no real size
     * could have traded at.
     *
     * @param bandBps  how far either side of the mid to count
     * @param minDepth least size that must rest inside it, in the market's size
     *                 precision. Zero disables the floor.
     * @param levels   ladder levels to inspect per side
     */
    function setDepthFloor(bytes32 marketId, uint32 bandBps, uint128 minDepth, uint8 levels)
        external
        onlyOwner
    {
        Book storage b = books[marketId];
        b.depthBandBps = bandBps;
        b.minDepth = minDepth;
        b.depthLevels = levels;
        emit DepthFloorSet(marketId, bandBps, minDepth, levels);
    }

    /**
     * @notice Record the current mark into this market's history.
     * @dev Permissionless on purpose. There is nothing to gain from calling it: the
     *      value written is read from the book by this contract, not supplied by the
     *      caller, so a poke can only make the average more accurate. Withholding pokes
     *      is the only lever an attacker has, and that is what the staleness check in
     *      `_twap` is for.
     *
     *      Returns false rather than reverting when the book has no valid mark, so a
     *      keeper poking on a timer is not fighting the guards.
     */
    function poke(bytes32 marketId) external returns (bool written) {
        Book memory b = books[marketId];
        (uint256 mark8,) = _spot(b, marketId);
        if (mark8 == 0) return false;


        uint16 count = obsCount[marketId];
        uint16 idx = obsIndex[marketId];
        uint32 nowT = uint32(block.timestamp);

        if (count == 0) {
            _obs[marketId][0] = Obs({t: nowT, cum: 0});
            obsIndex[marketId] = 0;
            obsCount[marketId] = 1;
            _emitPoked(b, marketId, mark8, nowT);
            return true;
        }

        Obs memory last = _obs[marketId][idx];
        // More than one poke in the same second adds nothing; the elapsed time is zero.
        if (nowT == last.t) return false;

        uint224 cum = last.cum + uint224(mark8) * uint224(nowT - last.t);
        uint16 next = uint16((idx + 1) % CARDINALITY);
        _obs[marketId][next] = Obs({t: nowT, cum: cum});
        obsIndex[marketId] = next;
        if (count < CARDINALITY) obsCount[marketId] = count + 1;

        _emitPoked(b, marketId, mark8, nowT);
        return true;
    }

    /**
     * @dev The conditions a reading was taken under, emitted alongside it.
     *
     *      Its own function because `poke` runs out of stack otherwise — and because
     *      the two callers there record the same thing and should not drift apart.
     */
    function _emitPoked(Book memory b, bytes32 marketId, uint256 mark8, uint32 at) internal {
        (uint256 rawBid, uint256 rawAsk) = b.market.bestBidAsk();
        uint256 spreadBps =
            (rawBid + rawAsk) == 0 ? 0 : ((rawAsk - rawBid) * BPS * 2) / (rawBid + rawAsk);
        emit Poked(
            marketId,
            mark8,
            at,
            rawBid / SCALE_DOWN,
            rawAsk / SCALE_DOWN,
            spreadBps,
            b.minDepth == 0 ? 0 : depthNearMid(marketId)
        );
    }

    /**
     * @notice Time-weighted average mark over the last `window` seconds.
     * @dev Zero when the history cannot support the window — too few readings, not
     *      enough elapsed time, or a newest reading old enough that the average would
     *      be describing a book that has since moved. Returning zero makes the market
     *      refuse to settle, which is the same answer every other guard here gives.
     */
    function twap(bytes32 marketId, uint32 window) external view returns (uint256) {
        return _twap(marketId, window);
    }

    function _twap(bytes32 marketId, uint32 window) internal view returns (uint256) {
        if (window == 0) return 0;
        uint16 count = obsCount[marketId];
        if (count < 2) return 0;

        uint16 idx = obsIndex[marketId];
        Obs memory newest = _obs[marketId][idx];

        /**
         * A history that stopped being written is not an average, it is a memory.
         *
         * The limit is absolute rather than a fraction of the window. Tying it to the
         * window looked tidy and was wrong: a three-second window gave a one-and-a-half
         * second tolerance, which is shorter than one poke's round trip, so the oracle
         * refused to price a book it had sixteen good readings of. The question this
         * guard asks — "is anyone still watching" — does not get a different answer for
         * a shorter window.
         *
         * Withholding pokes is the only lever this gives an attacker, and it costs them
         * the settlement rather than winning it: the market refuses to settle, it does
         * not settle wrong.
         */
        if (block.timestamp > uint256(newest.t) + MAX_OBS_AGE) return 0;

        // Walk back to the oldest reading still inside the window, or the oldest we have.
        uint32 target = uint32(block.timestamp) >= window
            ? uint32(block.timestamp) - window
            : 0;

        Obs memory oldest = newest;
        for (uint16 i = 1; i < count; i++) {
            Obs memory o = _obs[marketId][uint16((idx + CARDINALITY - i) % CARDINALITY)];
            oldest = o;
            if (o.t <= target) break;
        }

        if (newest.t <= oldest.t) return 0;
        uint32 span = newest.t - oldest.t;
        // Refuse to call a two-second sample a thirty-second average.
        if (span * 2 < window) return 0;

        return uint256(newest.cum - oldest.cum) / span;
    }

    // ----------------------------------------------------------------- reads

    /// @inheritdoc IXorrOracle
    /// @dev `updatedAt` is this block's timestamp, and that is the honest answer: the
    ///      book was read now. A stale reading of an order book is not a thing that can
    ///      happen — if the venue is quiet the orders are simply still there.
    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt) {
        Book memory b = books[marketId];

        /**
         * A configured window settles on the average, not on this instant.
         *
         * Everything below still runs first, because a book that fails its guards has
         * no price to average — an average of numbers the oracle would have refused is
         * not safer than the numbers, it just hides them.
         */
        if (b.twapWindow != 0) {
            uint256 avg = _twap(marketId, b.twapWindow);
            if (avg == 0) return (0, 0);
            // The spot read is the liveness check: if the book is one-sided, crossed or
            // too wide right now, the market does not settle, whatever the average says.
            (uint256 spot,) = _spot(b, marketId);
            if (spot == 0) return (0, 0);
            return (avg, block.timestamp);
        }

        return _spot(b, marketId);
    }

    /// @dev The instantaneous mark and its guards. `latest` is this, or an average of it.
    function _spot(Book memory b, bytes32 marketId)
        internal
        view
        returns (uint256 price, uint256 updatedAt)
    {
        if (!b.enabled || address(b.market) == address(0)) return (0, 0);

        (uint256 bid, uint256 ask) = b.market.bestBidAsk();

        // A one-sided book has no midpoint. Say so instead of inventing one.
        if (bid == 0 || ask == 0) return (0, 0);
        if (ask < bid) return (0, 0); // crossed; the venue is mid-update

        uint256 mid = _mark(b, marketId, bid, ask);
        if (mid == 0) return (0, 0);

        if (b.maxSpreadBps != 0) {
            // The spread is always measured against the plain midpoint, so the guard
            // means the same thing whichever mark is in use.
            uint256 spreadBps = ((ask - bid) * BPS * 2) / (bid + ask);
            // A book this thin is not a price anyone could trade at, and settling a
            // market on its midpoint would be settling on a number nobody quoted.
            if (spreadBps > b.maxSpreadBps) return (0, 0);
        }

        // A tight quote on no size is not a price either.
        if (b.minDepth != 0 && depthNearMid(marketId) < b.minDepth) return (0, 0);

        price = mid / SCALE_DOWN;
        if (price == 0) return (0, 0); // below 8-decimal resolution
        updatedAt = block.timestamp;
    }

    /**
     * @notice Base-asset size resting within the configured band of the mid, both sides.
     * @dev Prices in the ladder carry the market's pricePrecision and sizes its
     *      sizePrecision; only the ratio of prices is used here, so the band comparison
     *      is precision-free and the returned total stays in the market's own units.
     */
    function depthNearMid(bytes32 marketId) public view returns (uint256 total) {
        Book memory b = books[marketId];
        if (address(b.market) == address(0)) return 0;

        uint8 levels = b.depthLevels == 0 ? 8 : b.depthLevels;
        (, uint256[] memory bidPx, uint256[] memory bidSz, uint256[] memory askPx, uint256[] memory askSz)
        = depth(marketId, levels);

        uint256 topBid = bidPx.length > 0 ? bidPx[0] : 0;
        uint256 topAsk = askPx.length > 0 ? askPx[0] : 0;
        if (topBid == 0 || topAsk == 0) return 0;

        uint256 mid = (topBid + topAsk) / 2;
        uint256 band = (mid * b.depthBandBps) / BPS;

        for (uint256 i = 0; i < bidPx.length; i++) {
            if (bidPx[i] == 0) break;
            if (mid - bidPx[i] <= band) total += bidSz[i];
        }
        for (uint256 i = 0; i < askPx.length; i++) {
            if (askPx[i] == 0) break;
            if (askPx[i] - mid <= band) total += askSz[i];
        }
    }

    /**
     * @dev The configured mark. MICRO falls back to the midpoint when either side has
     *      no size to weight by — a weighted average of nothing is not a price.
     */
    function _mark(Book memory b, bytes32 marketId, uint256 bid, uint256 ask)
        internal
        view
        returns (uint256)
    {
        if (b.mark == Mark.MID) return (bid + ask) / 2;

        (uint256 bidSize, uint256 askSize) = _topSizes(marketId);
        if (bidSize == 0 || askSize == 0) return (bid + ask) / 2;

        /**
         * Both sides must carry real size before their ratio is trusted.
         *
         * The weighting is a ratio, so a single dust order sets it: with hundreds of
         * MON bid against a thousandth of one offered, the microprice pins itself to
         * the ask and a mark that should be robust becomes something anyone can move a
         * hundred basis points for the price of a dust order. Below the floor the
         * ratio carries no information and the plain midpoint is the honest answer.
         */
        uint256 floorSize = b.minDepth / MICRO_MIN_DEPTH_DIVISOR;
        if (floorSize != 0 && (bidSize < floorSize || askSize < floorSize)) {
            return (bid + ask) / 2;
        }

        // Each price weighted by the size resting on the other side.
        return (bid * askSize + ask * bidSize) / (bidSize + askSize);
    }

    /// @dev Size resting at the best bid and the best ask.
    function _topSizes(bytes32 marketId) internal view returns (uint256 bidSize, uint256 askSize) {
        (, , uint256[] memory bidSz, , uint256[] memory askSz) = depth(marketId, 1);
        bidSize = bidSz.length > 0 ? bidSz[0] : 0;
        askSize = askSz.length > 0 ? askSz[0] : 0;
    }

    /**
     * @notice The venue's own rules, read from the book rather than assumed.
     *
     * Tick size and the size bounds are what make a quote actionable: a band narrower
     * than a tick cannot be traded against, and a size under the minimum cannot be
     * filled at all. Reading them from the market means this contract never has to
     * hard-code a number the venue is free to change.
     */
    function marketParams(bytes32 marketId)
        external
        view
        returns (
            uint256 pricePrecision,
            uint256 sizePrecision,
            uint256 tickSize,
            uint256 minSize,
            uint256 maxSize,
            uint256 takerFeeBps
        )
    {
        Book memory b = books[marketId];
        if (address(b.market) == address(0)) revert NoBook();
        (
            uint32 pp,
            uint96 sp,
            ,
            ,
            ,
            ,
            uint32 tick,
            uint96 minS,
            uint96 maxS,
            uint96 fee
        ) = b.market.getMarketParams();
        return (pp, sp, tick, minS, maxS, fee);
    }

    /// @notice Both marks side by side, so the difference is visible rather than assumed.
    function marks(bytes32 marketId)
        external
        view
        returns (uint256 mid8, uint256 micro8, uint256 bidSize, uint256 askSize)
    {
        Book memory b = books[marketId];
        if (address(b.market) == address(0)) revert NoBook();
        (uint256 bid, uint256 ask) = b.market.bestBidAsk();
        if (bid == 0 || ask == 0) return (0, 0, 0, 0);

        (bidSize, askSize) = _topSizes(marketId);
        mid8 = ((bid + ask) / 2) / SCALE_DOWN;
        // Report what the oracle would actually use, dust guard included.
        micro8 = _mark(b, marketId, bid, ask) / SCALE_DOWN;
        if (b.mark == Mark.MID) {
            uint256 floorSize = b.minDepth / MICRO_MIN_DEPTH_DIVISOR;
            micro8 = (bidSize == 0 || askSize == 0)
                || (floorSize != 0 && (bidSize < floorSize || askSize < floorSize))
                ? mid8
                : ((bid * askSize + ask * bidSize) / (bidSize + askSize)) / SCALE_DOWN;
        }
    }

    function hasMarket(bytes32 marketId) external view returns (bool) {
        Book memory b = books[marketId];
        if (!b.enabled || address(b.market) == address(0)) return false;
        (uint256 bid, uint256 ask) = b.market.bestBidAsk();
        return bid != 0 && ask != 0 && ask >= bid;
    }

    /// @notice Best bid and ask as XORR sees them, in 8 decimals, plus the spread.
    /// @dev For the console's order-book panel: one call instead of decoding bytes in
    ///      the browser.
    function quoteTop(bytes32 marketId)
        external
        view
        returns (uint256 bid8, uint256 ask8, uint256 mid8, uint256 spreadBps)
    {
        Book memory b = books[marketId];
        if (address(b.market) == address(0)) revert NoBook();
        (uint256 bid, uint256 ask) = b.market.bestBidAsk();
        if (bid == 0 || ask == 0) return (0, 0, 0, 0);
        uint256 mid = (bid + ask) / 2;
        return (
            bid / SCALE_DOWN,
            ask / SCALE_DOWN,
            mid / SCALE_DOWN,
            mid == 0 ? 0 : ((ask > bid ? ask - bid : 0) * BPS) / mid
        );
    }

    /**
     * @notice Decoded L2 depth, so the console does not have to unpack bytes.
     * @dev Kuru packs the book as: block number, then (price, size) pairs for bids
     *      descending, a zero word, then (price, size) pairs for asks ascending.
     *      Prices and sizes carry the market's own precision and are returned as read —
     *      converting them here would bake in an assumption about a market this
     *      contract does not own.
     */
    function depth(bytes32 marketId, uint32 levels)
        public
        view
        returns (
            uint256 blockNumber,
            uint256[] memory bidPrices,
            uint256[] memory bidSizes,
            uint256[] memory askPrices,
            uint256[] memory askSizes
        )
    {
        Book memory b = books[marketId];
        if (address(b.market) == address(0)) revert NoBook();

        bytes memory raw = b.market.getL2Book(levels, levels);
        uint256 words = raw.length / 32;
        if (words == 0) return (0, bidPrices, bidSizes, askPrices, askSizes);

        bidPrices = new uint256[](levels);
        bidSizes = new uint256[](levels);
        askPrices = new uint256[](levels);
        askSizes = new uint256[](levels);

        blockNumber = _word(raw, 0);

        uint256 i = 1;
        uint256 n;
        // Bids run until the zero word that separates the sides.
        while (i + 1 < words && n < levels) {
            uint256 p = _word(raw, i);
            if (p == 0) break;
            bidPrices[n] = p;
            bidSizes[n] = _word(raw, i + 1);
            n++;
            i += 2;
        }

        // Skip the separator, then read the asks.
        while (i < words && _word(raw, i) == 0) i++;
        n = 0;
        while (i + 1 < words && n < levels) {
            uint256 p = _word(raw, i);
            if (p == 0) break;
            askPrices[n] = p;
            askSizes[n] = _word(raw, i + 1);
            n++;
            i += 2;
        }
    }

    function _word(bytes memory raw, uint256 index) internal pure returns (uint256 v) {
        uint256 offset = 32 + index * 32;
        assembly {
            v := mload(add(raw, offset))
        }
    }
}
