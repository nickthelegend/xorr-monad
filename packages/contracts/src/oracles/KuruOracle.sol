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
        bool enabled;
    }

    mapping(bytes32 => Book) public books;

    event BookSet(bytes32 indexed marketId, address market, uint32 maxSpreadBps, bool enabled);
    event DepthFloorSet(bytes32 indexed marketId, uint32 bandBps, uint128 minDepth, uint8 levels);

    error NoBook();
    error BadSpread();

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

    // ----------------------------------------------------------------- reads

    /// @inheritdoc IXorrOracle
    /// @dev `updatedAt` is this block's timestamp, and that is the honest answer: the
    ///      book was read now. A stale reading of an order book is not a thing that can
    ///      happen — if the venue is quiet the orders are simply still there.
    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt) {
        Book memory b = books[marketId];
        if (!b.enabled || address(b.market) == address(0)) return (0, 0);

        (uint256 bid, uint256 ask) = b.market.bestBidAsk();

        // A one-sided book has no midpoint. Say so instead of inventing one.
        if (bid == 0 || ask == 0) return (0, 0);
        if (ask < bid) return (0, 0); // crossed; the venue is mid-update

        uint256 mid = (bid + ask) / 2;
        if (mid == 0) return (0, 0);

        if (b.maxSpreadBps != 0) {
            uint256 spreadBps = ((ask - bid) * BPS) / mid;
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
