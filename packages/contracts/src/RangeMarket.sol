// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IXorrOracle} from "./interfaces/IXorrOracle.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {Owned, Pausable, ReentrancyGuard} from "./lib/Auth.sol";
import {Pricing} from "./lib/Pricing.sol";
import {XorrVault} from "./XorrVault.sol";

/// @title RangeMarket
/// @notice Paint a band, stake AUSD, find out at a block number instead of a clock.
///
///         XORR sells a fixed set of round lengths (`roundBlocks`, e.g. 10 / 33 / 100 /
///         333 / 1000 / 3000 blocks -- 3s to 15 minutes at Monad's 300ms cadence)
///         rather than an arbitrary block count, because each round length carries its
///         own MEASURED volatility. Pricing every horizon off one number scaled by
///         sqrt(time) is the standard move and it does not survive the tape: BTC's
///         one-sigma move over 30s is 3.3 bps but over 3s it is 0.9 bps, a ratio of 3.6
///         where sqrt(10) predicts 3.2, and the shape of the distribution changes far
///         more than the scale does.
///
///         Three deliberate departures from the original spec, all solvency-driven:
///
///         1. `fire` takes a round TIER, not an absolute `expiryBlock`. On a 300ms chain
///            an absolute target silently reprices, or reverts, under the user.
///
///         2. `stack` opens a NEW ticket sharing the parent's band and cutoff, quoted at
///            the price and remaining blocks at the moment of stacking. Topping up an
///            existing ticket at its original multiplier is free optionality: wait until
///            one block before the cutoff, see the price sitting dead centre, and stack
///            the maximum at odds priced when the outcome was still unknown. The desk
///            still reads "stack as many as you like, they all settle at the cutoff" --
///            each one is just honestly priced.
///
///         3. The multiplier is never clamped UP to a floor. A band too wide to pay 1.2x
///            is refused rather than sold at a price the vault cannot fund.
contract RangeMarket is Owned, Pausable, ReentrancyGuard {
    using SafeTransfer for IERC20;

    uint8 public constant PRICE_DECIMALS = 8;
    uint256 internal constant BPS = 10_000;

    uint8 public constant STATUS_OPEN = 0;
    uint8 public constant STATUS_WON = 1;
    uint8 public constant STATUS_LOST = 2;
    uint8 public constant STATUS_VOID = 3;

    struct Ticket {
        address player; //  20 bytes ─┐
        uint48 openBlock; //  6 bytes  │ slot 0
        uint48 expiryBlock; //  6 bytes ─┘
        bytes32 marketId; //           slot 1
        uint128 low; //           ─┐ slot 2
        uint128 high; //           ─┘
        uint128 stake; //           ─┐ slot 3
        uint128 payout; //           ─┘
        uint128 settledPrice; //  16 bytes ─┐
        uint32 multiplierBps; //   4 bytes  │
        uint24 prob1e6; //   3 bytes  │ slot 4
        uint8 status; //   1 byte   │
        uint64 parentId; //   8 bytes ─┘
    }

    /// @notice Everything one round length of one market needs to be priced.
    /// @dev maxMultiplierBps is per round, not global, because precision in the tail is
    ///      per round. An 8x ticket pays on a modelled 12.5% chance, so a 1.5 point
    ///      error in that probability is a 12% swing in expected value -- and out of
    ///      sample, on a three-second round, a 1.5 point error is ordinary. Each round
    ///      therefore sells only as deep into the tail as its own walk-forward
    ///      validation supports. See packages/sdk/src/calibrate-all.ts.
    struct RoundConfig {
        uint32 sigma1e4; // one-sigma move, bps of spot scaled by 1e4
        uint32 minProb1e6; // tightest band this round can price
        uint32 maxMultiplierBps; // ceiling implied by the above
    }

    IERC20 public immutable asset;
    XorrVault public immutable vault;
    IXorrOracle public oracle;

    mapping(bytes32 => bool) public marketEnabled;
    bytes32[] public marketIds;

    /// @notice The round lengths XORR sells, ascending. Shared across markets.
    uint32[] public roundBlocks;

    mapping(bytes32 => RoundConfig[]) internal _rounds;

    /// @notice T(z) = P(|move| <= z*sigma) on z = 0, 0.25 .. 4.00, in 1e6 fp, per
    ///         market AND per round. The shape changes with the horizon, not just the
    ///         scale: over three seconds BTC does not move at all about a third of the
    ///         time, and by fifteen minutes that point mass is gone entirely.
    mapping(bytes32 => mapping(uint256 => uint32[17])) internal _tables;

    mapping(uint64 => Ticket) public tickets;
    uint64 public nextTicketId = 1;
    mapping(address => uint64[]) internal _ticketsOf;

    uint256 public houseEdgeBps = 400; // 4%
    uint256 public minStake; // $1, set from asset decimals
    uint256 public maxStake; // $10
    uint256 public maxMultiplierBps = 80_000; // 8.00x hard ceiling, backstop only
    uint256 public minMultiplierBps = 12_000; // 1.20x floor: wider bands are not sellable
    uint256 public maxStaleness = 30; // seconds
    uint32 public settleWindowBlocks = 2_000; // ~10 min at 300ms, then the ticket voids
    uint16 public maxBatch = 20;

    event OracleSet(address indexed oracle);
    event RoundsSet(uint32[] roundBlocks);
    event MarketConfigured(bytes32 indexed marketId, uint256 roundCount, bool enabled);
    event TicketFired(
        uint64 indexed id,
        address indexed player,
        bytes32 indexed marketId,
        uint128 low,
        uint128 high,
        uint128 stake,
        uint128 payout,
        uint32 multiplierBps,
        uint24 prob1e6,
        uint48 openBlock,
        uint48 expiryBlock,
        uint128 spot,
        uint64 parentId
    );
    event TicketSettled(
        uint64 indexed id, address indexed player, uint8 status, uint128 settledPrice, uint128 paid
    );
    event ParamsSet(uint256 houseEdgeBps, uint256 minStake, uint256 maxStake);

    error MarketDisabled();
    error BadBand();
    error BadTier();
    error StakeOutOfRange(uint256 min, uint256 max);
    error BandTooWide(uint256 multiplierBps, uint256 floorBps);
    error BandTooTight(uint256 prob1e6, uint256 floor1e6);
    error NotOpen();
    error NotExpired(uint48 expiryBlock, uint256 current);
    error StalePrice(uint256 updatedAt, uint256 nowTs);
    error NoOracle();
    error BatchTooLarge();
    error NotParentOwner();
    error ParentNotOpen();
    error TooLateToStack();
    error RoundsNotSet();

    constructor(IERC20 _asset, XorrVault _vault, IXorrOracle _oracle, address _owner) Owned(_owner) {
        asset = _asset;
        vault = _vault;
        oracle = _oracle;
        uint256 unit = 10 ** _asset.decimals();
        minStake = unit; // $1
        maxStake = 10 * unit; // $10
        emit OracleSet(address(_oracle));
    }

    // ---------------------------------------------------------------- quoting

    function probTable(bytes32 marketId, uint8 tier) external view returns (uint32[17] memory) {
        return _tables[marketId][tier];
    }

    function roundConfig(bytes32 marketId, uint8 tier) external view returns (RoundConfig memory) {
        return _rounds[marketId][tier];
    }

    function roundConfigs(bytes32 marketId) external view returns (RoundConfig[] memory) {
        return _rounds[marketId];
    }

    function rounds() external view returns (uint32[] memory) {
        return roundBlocks;
    }

    function roundCount() external view returns (uint256) {
        return roundBlocks.length;
    }

    /// @notice The exact number the desk shows before you fire. Same code path as `fire`.
    function quote(bytes32 marketId, uint256 low, uint256 high, uint8 tier)
        public
        view
        returns (uint256 multiplierBps, uint256 prob1e6, uint256 spot)
    {
        if (tier >= roundBlocks.length) revert BadTier();
        return _quoteAt(marketId, low, high, tier, _rounds[marketId][tier].sigma1e4);
    }

    function _quoteAt(bytes32 marketId, uint256 low, uint256 high, uint8 tableTier, uint256 sigma1e4)
        internal
        view
        returns (uint256 multiplierBps, uint256 prob1e6, uint256 spot)
    {
        if (!marketEnabled[marketId]) revert MarketDisabled();

        uint256 updatedAt;
        (spot, updatedAt) = oracle.latest(marketId);
        if (spot == 0) revert NoOracle();
        if (block.timestamp > updatedAt + maxStaleness) revert StalePrice(updatedAt, block.timestamp);
        if (low >= spot || high <= spot) revert BadBand();

        (multiplierBps, prob1e6) =
            Pricing.quote(_tables[marketId][tableTier], spot, low, high, sigma1e4, houseEdgeBps);
    }

    /// @notice Sigma for a horizon that is not one of the sold round lengths, used when
    ///         a stack reprices against whatever blocks are actually left.
    /// @dev Interpolates between the two nearest MEASURED rounds rather than scaling one
    ///      of them by sqrt(time). Measured on real tape, sqrt-scaling does not hold at
    ///      these horizons, so interpolating between two calibrated points is the only
    ///      honest way to price the gap. The distribution shape is taken from the LOWER
    ///      bracketing round, which carries the larger point mass at zero and therefore
    ///      the higher win probability and the lower multiplier: conservative by
    ///      construction.
    function sigmaForBlocks(bytes32 marketId, uint256 remaining)
        public
        view
        returns (uint256 sigma1e4, uint8 tableTier)
    {
        RoundConfig[] memory rc = _rounds[marketId];
        uint256 n = roundBlocks.length;
        if (n == 0 || rc.length != n) revert RoundsNotSet();

        if (remaining <= roundBlocks[0]) return (rc[0].sigma1e4, 0);
        if (remaining >= roundBlocks[n - 1]) return (rc[n - 1].sigma1e4, uint8(n - 1));

        for (uint256 i = 0; i + 1 < n; i++) {
            uint256 lo = roundBlocks[i];
            uint256 hi = roundBlocks[i + 1];
            if (remaining >= lo && remaining <= hi) {
                uint256 sLo = rc[i].sigma1e4;
                uint256 sHi = rc[i + 1].sigma1e4;
                sigma1e4 = sLo + ((sHi - sLo) * (remaining - lo)) / (hi - lo);
                return (sigma1e4, uint8(i));
            }
        }
        return (rc[0].sigma1e4, 0);
    }

    /// @notice Widest band still sellable and tightest band still payable, for the
    ///         painter. Returned as 1e4-scaled bps because a three-second band is
    ///         under a basis point wide and whole-bps limits would collapse the
    ///         painter to a handful of usable positions.
    function bandLimits(bytes32 marketId, uint8 tier)
        external
        view
        returns (uint256 spot, uint256 sig1e4, uint256 maxHalfWidth1e4, uint256 minHalfWidth1e4)
    {
        if (tier >= roundBlocks.length) revert BadTier();
        RoundConfig memory rc = _rounds[marketId][tier];
        uint32[17] memory t = _tables[marketId][tier];
        (spot,) = oracle.latest(marketId);
        sig1e4 = rc.sigma1e4;

        // Solve the endpoints against the same arithmetic `fire` uses.
        //
        // Deriving a half-width from a z analytically looks right and is not: the trip
        // from z to a 1e4-scaled width to an 8-decimal price and back loses a unit at
        // each truncating division, and the tightest band the painter offered came
        // back one unit under the probability floor. A player who dragged the rules to
        // the stop was told BAND TOO TIGHT by the market that had just offered it.
        //
        // Bisecting on the width itself, and asking probInside the same question
        // `_open` asks, makes both endpoints exactly the extremes that are fireable.
        uint256 pAtFloor = (1e6 * (BPS - houseEdgeBps)) / minMultiplierBps;
        minHalfWidth1e4 = _solveHalfWidth(t, spot, sig1e4, rc.minProb1e6, true);
        maxHalfWidth1e4 = _solveHalfWidth(t, spot, sig1e4, pAtFloor, false);
    }

    /// @dev Widest band whose win probability is still <= target (`lowest` false), or
    ///      tightest band whose probability is already >= target (`lowest` true).
    ///      Probability rises with width, so both are plain bisections.
    function _solveHalfWidth(
        uint32[17] memory t,
        uint256 spot,
        uint256 sig1e4,
        uint256 targetProb,
        bool lowest
    ) internal pure returns (uint256) {
        uint256 lo = 1;
        uint256 hi = 1e8; // 1e4-scaled bps; 1e8 is a 100% wide band

        for (uint256 i = 0; i < 40 && lo < hi; i++) {
            uint256 mid = lowest ? (lo + hi) / 2 : (lo + hi + 1) / 2;
            uint256 half = (spot * mid) / 1e8;

            uint256 p;
            if (half == 0 || half >= spot) {
                p = half == 0 ? 0 : 1e6;
            } else {
                p = Pricing.probInside(t, spot, spot - half, spot + half, sig1e4);
            }

            if (lowest) {
                if (p >= targetProb) hi = mid;
                else lo = mid + 1;
            } else {
                if (p <= targetProb) lo = mid;
                else hi = mid - 1;
            }
        }
        return lo > hi ? hi : lo;
    }

    /// @dev Invert T(z) by bisecting the same table Pricing interpolates. z is 1e4 fp.
    function _zForProb(uint32[17] memory t, uint256 p1e6) internal pure returns (uint256) {
        if (p1e6 >= Pricing.PROB_ONE) return Pricing.Z_MAX;
        uint256 lo = 0;
        uint256 hi = Pricing.Z_MAX;
        for (uint256 i = 0; i < 24; i++) {
            uint256 mid = (lo + hi) / 2;
            if (Pricing.halfProb(t, mid) < p1e6) lo = mid;
            else hi = mid;
        }
        return hi;
    }

    // ------------------------------------------------------------------ play

    /// @notice Paint a band and put money on it.
    /// @param tier index into `roundBlocks` -- how long the round runs
    /// @notice Fire a band described as half-widths around the current print, letting
    ///         the market centre it on the oracle price in the same transaction.
    ///
    ///         The absolute-price `fire` below has an unavoidable race: a caller reads
    ///         spot, paints a band a few basis points wide around it, and by the time
    ///         the transaction lands the price has moved outside its own band and the
    ///         open reverts. On a 300ms chain with bands this tight that is not an edge
    ///         case, it is the common case. Passing the shape rather than the endpoints
    ///         removes the race: the band is centred on whatever the market prints when
    ///         the transaction executes.
    ///
    /// @param lowHalf1e4  distance below spot, in 1e4-scaled basis points
    /// @param highHalf1e4 distance above spot, in 1e4-scaled basis points
    function fireBand(
        bytes32 marketId,
        uint32 lowHalf1e4,
        uint32 highHalf1e4,
        uint128 stake,
        uint8 tier
    ) external nonReentrant whenNotPaused returns (uint64 id) {
        if (tier >= roundBlocks.length) revert BadTier();

        // Freshness and the zero case are enforced inside _open, which reads the same
        // print again; this read only shapes the band.
        (uint256 spot,) = oracle.latest(marketId);
        if (spot == 0) revert BadBand();

        uint256 lowGap = (spot * lowHalf1e4) / 1e8;
        uint256 highGap = (spot * highHalf1e4) / 1e8;
        if (lowGap == 0 || highGap == 0 || lowGap >= spot) revert BadBand();

        return _open(
            OpenParams({
                marketId: marketId,
                low: uint128(spot - lowGap),
                high: uint128(spot + highGap),
                stake: stake,
                expiryBlock: uint48(block.number + roundBlocks[tier]),
                tier: tier,
                sigma1e4: _rounds[marketId][tier].sigma1e4,
                parentId: 0
            })
        );
    }

    function fire(bytes32 marketId, uint128 low, uint128 high, uint128 stake, uint8 tier)
        external
        nonReentrant
        whenNotPaused
        returns (uint64 id)
    {
        if (tier >= roundBlocks.length) revert BadTier();
        return _open(
            OpenParams({
                marketId: marketId,
                low: low,
                high: high,
                stake: stake,
                expiryBlock: uint48(block.number + roundBlocks[tier]),
                tier: tier,
                sigma1e4: _rounds[marketId][tier].sigma1e4,
                parentId: 0
            })
        );
    }

    /// @notice Another ticket on the same band and the same cutoff, priced right now.
    /// @dev Uses the largest round tier at or below the blocks actually remaining, so
    ///      the sigma applied is never longer-horizon (and therefore never larger) than
    ///      the real remaining risk. Once fewer blocks remain than the shortest round,
    ///      there is no measured distribution to price against and stacking closes.
    function stack(uint64 parentId, uint128 extraStake)
        external
        nonReentrant
        whenNotPaused
        returns (uint64 id)
    {
        Ticket memory p = tickets[parentId];
        if (p.player != msg.sender) revert NotParentOwner();
        if (p.status != STATUS_OPEN) revert ParentNotOpen();
        if (block.number >= p.expiryBlock) revert NotOpen();

        uint256 remaining = uint256(p.expiryBlock) - block.number;
        if (roundBlocks.length == 0) revert RoundsNotSet();
        if (remaining < roundBlocks[0]) revert TooLateToStack();

        (uint256 sigma1e4, uint8 tableTier) = sigmaForBlocks(p.marketId, remaining);
        return _open(
            OpenParams({
                marketId: p.marketId,
                low: p.low,
                high: p.high,
                stake: extraStake,
                expiryBlock: p.expiryBlock,
                tier: tableTier,
                sigma1e4: sigma1e4,
                parentId: parentId
            })
        );
    }

    /// @dev Bundled so `_open` stays under the 16-slot stack limit without via-ir.
    struct OpenParams {
        bytes32 marketId;
        uint128 low;
        uint128 high;
        uint128 stake;
        uint48 expiryBlock;
        uint8 tier;
        uint256 sigma1e4;
        uint64 parentId;
    }

    function _open(OpenParams memory p) internal returns (uint64 id) {
        if (p.stake < minStake || p.stake > maxStake) revert StakeOutOfRange(minStake, maxStake);
        if (p.low >= p.high) revert BadBand();

        (uint256 mult, uint256 prob, uint256 spot) =
            _quoteAt(p.marketId, p.low, p.high, p.tier, p.sigma1e4);

        {
            RoundConfig memory rc = _rounds[p.marketId][p.tier];
            if (prob < rc.minProb1e6) revert BandTooTight(prob, rc.minProb1e6);
            if (mult < minMultiplierBps) revert BandTooWide(mult, minMultiplierBps);
            uint256 ceiling =
                rc.maxMultiplierBps < maxMultiplierBps ? rc.maxMultiplierBps : maxMultiplierBps;
            if (mult > ceiling) mult = ceiling;
        }

        uint128 payout = uint128((uint256(p.stake) * mult) / BPS);

        // Stake lands in the vault first, then the payout is reserved against it.
        asset.safeTransferFrom(msg.sender, address(vault), p.stake);
        vault.reserve(payout);

        id = nextTicketId++;
        tickets[id] = Ticket({
            player: msg.sender,
            openBlock: uint48(block.number),
            expiryBlock: p.expiryBlock,
            marketId: p.marketId,
            low: p.low,
            high: p.high,
            stake: p.stake,
            payout: payout,
            settledPrice: 0,
            multiplierBps: uint32(mult),
            prob1e6: uint24(prob),
            status: STATUS_OPEN,
            parentId: p.parentId
        });
        _ticketsOf[msg.sender].push(id);

        _emitFired(id, uint128(spot));
    }

    /// @dev Reads the freshly written ticket back out of storage so `_open` keeps its
    ///      stack under the 16-slot limit without reaching for via-ir.
    function _emitFired(uint64 id, uint128 spot) internal {
        Ticket memory t = tickets[id];
        emit TicketFired(
            id,
            t.player,
            t.marketId,
            t.low,
            t.high,
            t.stake,
            t.payout,
            t.multiplierBps,
            t.prob1e6,
            t.openBlock,
            t.expiryBlock,
            spot,
            t.parentId
        );
    }

    // --------------------------------------------------------------- settle

    /// @notice Anyone can poke a ticket once its cutoff block has passed.
    function settle(uint64 id) public nonReentrant returns (uint8 status) {
        return _settle(id);
    }

    function settleBatch(uint64[] calldata ids) external nonReentrant returns (uint8[] memory out) {
        if (ids.length > maxBatch) revert BatchTooLarge();
        out = new uint8[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = _settle(ids[i]);
        }
    }

    function _settle(uint64 id) internal returns (uint8) {
        Ticket storage t = tickets[id];
        if (t.status != STATUS_OPEN) revert NotOpen();
        if (block.number < t.expiryBlock) revert NotExpired(t.expiryBlock, block.number);

        bool pastWindow = block.number > uint256(t.expiryBlock) + settleWindowBlocks;

        (uint256 price, uint256 updatedAt) = oracle.latest(t.marketId);
        bool fresh = price != 0 && block.timestamp <= updatedAt + maxStaleness;

        // A print we cannot trust inside the window means "try again in a moment".
        // Past the window the ticket voids so nobody is ever stuck on a dead feed.
        if (!fresh && !pastWindow) revert StalePrice(updatedAt, block.timestamp);

        if (!fresh) {
            t.status = STATUS_VOID;
            vault.release(t.payout);
            vault.pay(t.player, t.stake);
            emit TicketSettled(id, t.player, STATUS_VOID, 0, t.stake);
            return STATUS_VOID;
        }

        t.settledPrice = uint128(price);

        if (price >= t.low && price <= t.high) {
            t.status = STATUS_WON;
            vault.releaseAndPay(t.payout, t.player, t.payout);
            emit TicketSettled(id, t.player, STATUS_WON, uint128(price), t.payout);
            return STATUS_WON;
        }

        t.status = STATUS_LOST;
        vault.release(t.payout); // stake stays with the vault
        emit TicketSettled(id, t.player, STATUS_LOST, uint128(price), 0);
        return STATUS_LOST;
    }

    // ----------------------------------------------------------------- views

    function ticketsOf(address player) external view returns (uint64[] memory) {
        return _ticketsOf[player];
    }

    function ticketCountOf(address player) external view returns (uint256) {
        return _ticketsOf[player].length;
    }

    function getTicket(uint64 id) external view returns (Ticket memory) {
        return tickets[id];
    }

    function allMarkets() external view returns (bytes32[] memory) {
        return marketIds;
    }

    // ----------------------------------------------------------------- admin

    function setOracle(IXorrOracle o) external onlyOwner {
        oracle = o;
        emit OracleSet(address(o));
    }

    /// @notice Set the round lengths XORR sells, ascending.
    function setRounds(uint32[] calldata blocks_) external onlyOwner {
        require(blocks_.length > 0 && blocks_.length <= 16, "rounds");
        for (uint256 i = 1; i < blocks_.length; i++) {
            require(blocks_[i] > blocks_[i - 1], "ascending");
        }
        roundBlocks = blocks_;
        emit RoundsSet(blocks_);
    }

    /// @notice Configure a market's measured distribution and per-round parameters.
    /// @param tables T(z) = P(|move| <= z*sigma) on the 0.25 grid, 1e6 fp, one per
    ///        round tier. Generated by packages/sdk/src/calibrate-all.ts from real
    ///        tape. Pricing.normalTable() is the fallback for an unmeasured market and
    ///        should not be used to back live money.
    function configureMarket(
        bytes32 marketId,
        RoundConfig[] calldata cfgs,
        uint32[17][] calldata tables,
        bool enabled
    ) external onlyOwner {
        require(cfgs.length == roundBlocks.length, "rounds");
        require(tables.length == roundBlocks.length, "tables");

        delete _rounds[marketId];
        for (uint256 i = 0; i < cfgs.length; i++) {
            require(cfgs[i].sigma1e4 > 0, "sigma");
            require(cfgs[i].minProb1e6 > 0 && cfgs[i].minProb1e6 <= 1e6, "minProb");
            require(cfgs[i].maxMultiplierBps >= BPS, "maxMult");
            Pricing.validateTable(tables[i]);
            _rounds[marketId].push(cfgs[i]);
            _tables[marketId][i] = tables[i];
        }

        if (!marketEnabled[marketId] && enabled) marketIds.push(marketId);
        marketEnabled[marketId] = enabled;
        emit MarketConfigured(marketId, cfgs.length, enabled);
    }

    /// @notice Re-mark volatility and tail limits without touching the measured shape.
    ///         The keeper calls this as realised vol drifts; the distribution changes
    ///         far more slowly than its scale does.
    function setRoundConfigs(bytes32 marketId, RoundConfig[] calldata cfgs) external onlyOwner {
        require(cfgs.length == roundBlocks.length, "rounds");
        delete _rounds[marketId];
        for (uint256 i = 0; i < cfgs.length; i++) {
            require(cfgs[i].sigma1e4 > 0, "sigma");
            require(cfgs[i].minProb1e6 > 0 && cfgs[i].minProb1e6 <= 1e6, "minProb");
            require(cfgs[i].maxMultiplierBps >= BPS, "maxMult");
            _rounds[marketId].push(cfgs[i]);
        }
        emit MarketConfigured(marketId, cfgs.length, marketEnabled[marketId]);
    }

    function setEnabled(bytes32 marketId, bool enabled) external onlyOwner {
        marketEnabled[marketId] = enabled;
        emit MarketConfigured(marketId, _rounds[marketId].length, enabled);
    }

    function setParams(uint256 _houseEdgeBps, uint256 _minStake, uint256 _maxStake) external onlyOwner {
        require(_houseEdgeBps <= 2_000 && _minStake <= _maxStake, "params");
        houseEdgeBps = _houseEdgeBps;
        minStake = _minStake;
        maxStake = _maxStake;
        emit ParamsSet(_houseEdgeBps, _minStake, _maxStake);
    }

    function setLimits(
        uint256 _maxMultiplierBps,
        uint256 _minMultiplierBps,
        uint256 _maxStaleness,
        uint32 _settleWindowBlocks,
        uint16 _maxBatch
    ) external onlyOwner {
        require(_maxMultiplierBps <= 80_000 && _minMultiplierBps >= BPS, "limits");
        require(_maxBatch > 0 && _maxBatch <= 50, "batch");
        maxMultiplierBps = _maxMultiplierBps;
        minMultiplierBps = _minMultiplierBps;
        maxStaleness = _maxStaleness;
        settleWindowBlocks = _settleWindowBlocks;
        maxBatch = _maxBatch;
    }
}
