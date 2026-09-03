// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KuruOracle} from "../src/oracles/KuruOracle.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuruOrderBook.sol";

/// @dev A book whose contents the test controls, for the cases a live venue will not
///      reproduce on demand: an empty side, a crossed book, a spread blown wide open.
///      The happy path is covered against the real deployed market in the fork tests
///      below — this double exists only to reach states real liquidity will not sit in.
contract BookDouble is IKuruOrderBook {
    uint256 public bid;
    uint256 public ask;
    bytes internal book;

    function set(uint256 _bid, uint256 _ask) external {
        bid = _bid;
        ask = _ask;
    }

    function setBook(bytes calldata b) external {
        book = b;
    }

    function bestBidAsk() external view returns (uint256, uint256) {
        return (bid, ask);
    }

    function getL2Book(uint32, uint32) external view returns (bytes memory) {
        return book;
    }

    /// @dev The live MON-AUSD market's actual configuration.
    function getMarketParams()
        external
        pure
        returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint96)
    {
        return (
            1e8,                                        // pricePrecision
            1e10,                                       // sizePrecision
            address(0),                                 // base: native MON
            18,
            0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a, // quote: AUSD
            6,
            100,                                        // tickSize
            2e12,                                       // minSize
            2e19,                                       // maxSize
            0                                           // takerFeeBps
        );
    }
}

contract KuruOracleUnitTest is Test {
    KuruOracle internal oracle;
    BookDouble internal book;
    address internal owner = address(0xA11CE);
    bytes32 internal constant MON = keccak256("MON-USD");

    function setUp() public {
        oracle = new KuruOracle(owner);
        book = new BookDouble();
        vm.prank(owner);
        oracle.setBook(MON, address(book), 500, true);
    }

    // ------------------------------------------------------- the averaged mark

    /// @dev Walk the book forward, poking once a second, so the history is real rather
    ///      than written directly into storage.
    function _run(uint256 bid, uint256 ask, uint256 secs) internal {
        book.set(bid, ask);
        for (uint256 i = 0; i < secs; i++) {
            vm.warp(block.timestamp + 1);
            oracle.poke(MON);
        }
    }

    /**
     * The whole point of the window: a book moved for one block barely moves the mark.
     *
     * Thirty seconds of history at one price, then a single second at a price 20% away
     * — which is what an attacker who owns the cutoff block can produce. The spot mark
     * follows them all the way; the average barely notices.
     */
    function test_ASingleBlockCannotMoveTheAveragedMark() public {
        vm.prank(owner);
        oracle.setTwapWindow(MON, 30);

        _run(25_442_000_000_000_000, 25_952_000_000_000_000, 30); // ~0.025697 mid
        (uint256 calm,) = oracle.latest(MON);

        // One second of a book pushed 20% higher.
        _run(30_530_000_000_000_000, 31_142_000_000_000_000, 1);
        (uint256 attacked,) = oracle.latest(MON);

        // What the market would have settled on with no window at all.
        vm.prank(owner);
        oracle.setTwapWindow(MON, 0);
        (uint256 spot,) = oracle.latest(MON);

        assertApproxEqRel(spot, 3_083_600, 0.01e18, "spot follows the attacker");
        assertApproxEqRel(calm, 2_569_700, 0.01e18, "the average before the push");

        uint256 spotMove = ((spot - calm) * 10_000) / calm;
        uint256 avgMove = ((attacked - calm) * 10_000) / calm;
        assertGt(spotMove, 1_800, "a spot mark moves ~20%");
        assertLt(avgMove, 100, "one second in thirty moves the average under 1%");
    }

    /// @notice Holding the book away from its price for the whole window DOES move the
    ///         average — and that is correct. The design does not claim to be
    ///         unmanipulable, it claims manipulation costs the whole round.
    function test_SustainedManipulationDoesMoveIt() public {
        vm.prank(owner);
        oracle.setTwapWindow(MON, 30);

        _run(25_442_000_000_000_000, 25_952_000_000_000_000, 40);
        (uint256 before,) = oracle.latest(MON);

        _run(30_530_000_000_000_000, 31_142_000_000_000_000, 40);
        (uint256 after_,) = oracle.latest(MON);

        assertApproxEqRel(after_, 3_083_600, 0.02e18, "held for the whole window, it lands there");
        assertGt(after_, before);
    }

    /// @notice A history nobody is writing is a memory, not an average.
    function test_AStaleHistoryRefusesToSettle() public {
        vm.prank(owner);
        oracle.setTwapWindow(MON, 30);
        _run(25_442_000_000_000_000, 25_952_000_000_000_000, 40);

        (uint256 fresh,) = oracle.latest(MON);
        assertGt(fresh, 0);

        // Nobody pokes for longer than the oracle's tolerance.
        vm.warp(block.timestamp + 6);
        (uint256 stale,) = oracle.latest(MON);
        assertEq(stale, 0, "an unmaintained history must not settle a market");
    }

    /// @notice Too little history is refused rather than averaged over a short span.
    function test_TooLittleHistoryRefusesToSettle() public {
        vm.prank(owner);
        oracle.setTwapWindow(MON, 30);
        _run(25_442_000_000_000_000, 25_952_000_000_000_000, 3);

        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0, "three seconds is not a thirty-second average");
    }

    /// @notice The guards still run. An average of readings the oracle would have
    ///         refused is not safer than the readings.
    function test_TheSpotGuardsStillApplyUnderAWindow() public {
        vm.prank(owner);
        oracle.setTwapWindow(MON, 30);
        _run(25_442_000_000_000_000, 25_952_000_000_000_000, 40);
        assertGt(_price(), 0);

        // The book goes one-sided right now, whatever the history says.
        book.set(0, 25_952_000_000_000_000);
        assertEq(_price(), 0, "a one-sided book does not settle on an old average");
    }

    function _price() internal view returns (uint256 p) {
        (p,) = oracle.latest(MON);
    }

    /// @notice Poking a book with no valid mark writes nothing and does not revert.
    function test_PokeOnABadBookIsANoop() public {
        book.set(0, 0);
        assertFalse(oracle.poke(MON), "nothing to record");
        assertEq(oracle.obsCount(MON), 0);
    }

    function test_TwapWindowIsOwnerOnly() public {
        vm.expectRevert();
        oracle.setTwapWindow(MON, 30);
    }

    function test_MidOfTheBookIsThePrice() public {
        book.set(25_442_000_000_000_000, 25_952_000_000_000_000); // 0.025442 / 0.025952
        (uint256 p, uint256 t) = oracle.latest(MON);
        assertEq(p, 2_569_700, "mid, scaled to 8 decimals");
        assertEq(t, block.timestamp, "reading a book is an observation, not a report");
    }

    /// @notice A book with nothing on one side has no midpoint. Reporting one would be
    ///         inventing a price, which is the one thing an oracle must never do.
    function test_OneSidedBookHasNoPrice() public {
        book.set(25_442_000_000_000_000, 0);
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0);

        book.set(0, 25_952_000_000_000_000);
        (p,) = oracle.latest(MON);
        assertEq(p, 0);
    }

    /// @notice Mid-update the book can appear crossed. That is a snapshot artifact, not
    ///         a price.
    function test_CrossedBookHasNoPrice() public {
        book.set(25_952_000_000_000_000, 25_442_000_000_000_000);
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0);
    }

    /// @notice The midpoint of a very wide book is a number nobody quoted. Settling a
    ///         market on it would be settling on fiction.
    function test_TooWideASpreadIsRefused() public {
        // 0.02 / 0.03 -> mid 0.025, spread 4000 bps, guard is 500.
        book.set(20_000_000_000_000_000, 30_000_000_000_000_000);
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0, "a 40% spread is not a price");
        assertFalse(oracle.hasMarket(MON) && p != 0);
    }

    function test_SpreadGuardCanBeDisabled() public {
        vm.prank(owner);
        oracle.setBook(MON, address(book), 0, true);
        book.set(20_000_000_000_000_000, 30_000_000_000_000_000);
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 2_500_000);
    }

    function test_DisabledBookReportsNothing() public {
        book.set(25_442_000_000_000_000, 25_952_000_000_000_000);
        vm.prank(owner);
        oracle.setBook(MON, address(book), 500, false);
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0);
        assertFalse(oracle.hasMarket(MON));
    }

    function test_UnknownMarketReportsNothing() public view {
        (uint256 p, uint256 t) = oracle.latest(keccak256("NOPE"));
        assertEq(p, 0);
        assertEq(t, 0);
    }

    function test_OnlyOwnerSetsBooks() public {
        vm.expectRevert();
        oracle.setBook(MON, address(book), 500, true);
    }

    /// @notice A price below 8-decimal resolution is reported as no price rather than
    ///         rounded to zero and treated as real.
    function test_SubResolutionPriceIsRefused() public {
        book.set(1, 3); // mid 2 wei, far under 1e10
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0);
    }

    /**
     * A pair of dust orders one tick apart passes every spread check and is not a
     * market. The depth floor is what separates "quoted tightly" from "tradeable".
     */
    function test_ATightQuoteOnNoSizeIsRefused() public {
        book.set(25_442_000_000_000_000, 25_452_000_000_000_000); // 4 bps apart
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(1e6), // dust
                uint256(0),
                uint256(2_545_200), uint256(1e6)
            )
        );

        // Without a floor, that dust prices the market.
        (uint256 before,) = oracle.latest(MON);
        assertGt(before, 0, "spread alone cannot tell the difference");

        vm.prank(owner);
        oracle.setDepthFloor(MON, 100, 100e10, 4); // need 100 base within 1%

        (uint256 after_,) = oracle.latest(MON);
        assertEq(after_, 0, "a tight quote on nothing is not a price");
    }

    function test_RealSizeClearsTheFloor() public {
        book.set(25_442_000_000_000_000, 25_452_000_000_000_000);
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(300e10),
                uint256(0),
                uint256(2_545_200), uint256(300e10)
            )
        );
        vm.prank(owner);
        oracle.setDepthFloor(MON, 100, 100e10, 4);

        (uint256 p,) = oracle.latest(MON);
        assertGt(p, 0);
        assertGe(oracle.depthNearMid(MON), 100e10);
    }

    /// @notice Size resting far from the mid is not size you can settle against.
    function test_DepthFarFromTheMidDoesNotCount() public {
        book.set(25_442_000_000_000_000, 25_452_000_000_000_000);
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(1e10),   // near, tiny
                uint256(1_000_000), uint256(900e10), // far below, huge
                uint256(0),
                uint256(2_545_200), uint256(1e10)
            )
        );
        vm.prank(owner);
        oracle.setDepthFloor(MON, 100, 100e10, 4);

        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0, "a wall 60% away is not depth at the mid");
    }

    function test_DepthFloorIsOwnerOnly() public {
        vm.expectRevert();
        oracle.setDepthFloor(MON, 100, 1, 4);
    }

    /**
     * A midpoint treats both sides as equally informative. When one side rests two
     * orders of magnitude more size than the other, that is plainly wrong — it takes
     * almost nothing to clear the thin side, so fair value sits closer to it.
     */
    function test_MicropriceLeansTowardTheThinSide() public {
        book.set(25_442_000_000_000_000, 25_952_000_000_000_000);
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(3589e10), // deep bid
                uint256(0),
                uint256(2_595_200), uint256(18e10)    // thin ask
            )
        );

        vm.prank(owner);
        oracle.setMark(MON, KuruOracle.Mark.MICRO);

        (uint256 mid, uint256 micro, uint256 bidSize, uint256 askSize) = oracle.marks(MON);
        assertGt(bidSize, askSize * 100, "the book is genuinely lopsided");
        assertGt(micro, mid, "a thin ask pulls fair value up toward it");
        assertLt(micro, 2_595_200, "but never past the ask itself");

        (uint256 p,) = oracle.latest(MON);
        assertEq(p, micro, "and that is the price the market settles on");
    }

    function test_MidRemainsAvailableAndIsTheDefault() public {
        book.set(25_442_000_000_000_000, 25_952_000_000_000_000);
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(3589e10),
                uint256(0),
                uint256(2_595_200), uint256(18e10)
            )
        );
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 2_569_700, "unset books mark at the midpoint");
    }

    /// @notice A weighted average of nothing is not a price; fall back to the midpoint.
    function test_MicropriceFallsBackWhenASideHasNoSize() public {
        book.set(25_442_000_000_000_000, 25_952_000_000_000_000);
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(0),
                uint256(0),
                uint256(2_595_200), uint256(0)
            )
        );
        vm.prank(owner);
        oracle.setMark(MON, KuruOracle.Mark.MICRO);
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 2_569_700);
    }

    /// @notice The spread guard must mean the same thing whichever mark is in use.
    function test_SpreadGuardIsUnaffectedByTheMark() public {
        book.set(20_000_000_000_000_000, 30_000_000_000_000_000); // 4000 bps
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_000_000), uint256(3589e10),
                uint256(0),
                uint256(3_000_000), uint256(18e10)
            )
        );
        vm.prank(owner);
        oracle.setMark(MON, KuruOracle.Mark.MICRO);
        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 0, "a 40% spread is refused under either mark");
    }

    function test_MarkIsOwnerOnly() public {
        vm.expectRevert();
        oracle.setMark(MON, KuruOracle.Mark.MICRO);
    }

    /**
     * The weighting is a ratio, so a single dust order can set it. With hundreds on one
     * side and a thousandth on the other, an unguarded microprice pins to the thin side
     * — a mark anyone could move a hundred basis points for the price of a dust order.
     */
    function test_DustOnOneSideCannotSetTheMark() public {
        book.set(25_442_000_000_000_000, 25_952_000_000_000_000);
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(376e10),   // real size
                uint256(0),
                uint256(2_595_200), uint256(13_000)    // dust: 0.0000013
            )
        );
        vm.startPrank(owner);
        oracle.setMark(MON, KuruOracle.Mark.MICRO);
        oracle.setDepthFloor(MON, 100, 100e10, 4);
        vm.stopPrank();

        (uint256 p,) = oracle.latest(MON);
        assertEq(p, 2_569_700, "falls back to the midpoint rather than pinning to dust");
    }

    /// @notice Ordinary imbalance must still move the mark — the guard is for dust only.
    function test_OrdinaryImbalanceStillWeightsTheMark() public {
        book.set(25_442_000_000_000_000, 25_952_000_000_000_000);
        book.setBook(
            abi.encode(
                uint256(1),
                uint256(2_544_200), uint256(376e10),
                uint256(0),
                uint256(2_595_200), uint256(20e10)   // thin, but real
            )
        );
        vm.startPrank(owner);
        oracle.setMark(MON, KuruOracle.Mark.MICRO);
        oracle.setDepthFloor(MON, 100, 100e10, 4);
        vm.stopPrank();

        (uint256 p,) = oracle.latest(MON);
        assertGt(p, 2_569_700, "a genuinely thin ask still pulls the mark up");
        assertLt(p, 2_595_200, "but never past the ask");
    }

    /// @notice The venue's rules are read from the book, never hard-coded here.
    function test_MarketParamsComeFromTheVenue() public view {
        (uint256 pp, uint256 sp, uint256 tick, uint256 minS, uint256 maxS, uint256 fee) =
            oracle.marketParams(MON);
        assertEq(pp, 1e8, "price precision");
        assertEq(sp, 1e10, "size precision");
        assertEq(tick, 100, "tick size");
        assertEq(minS, 2e12, "minimum order");
        assertEq(maxS, 2e19, "maximum order");
        assertEq(fee, 0, "taker fee");
    }

    function test_MarketParamsRevertsForAnUnknownBook() public {
        vm.expectRevert(KuruOracle.NoBook.selector);
        oracle.marketParams(keccak256("NOPE"));
    }

    function test_DepthDecodesBidsThenAsks() public {
        // block, (bid px,sz) x2, 0 separator, (ask px,sz) x2
        bytes memory packed = abi.encode(
            uint256(12345),
            uint256(2_544_200), uint256(376e10),
            uint256(2_535_000), uint256(312e10),
            uint256(0),
            uint256(2_595_200), uint256(100e10),
            uint256(2_612_300), uint256(307e10)
        );
        book.setBook(packed);

        (
            uint256 blockNumber,
            uint256[] memory bidPx,
            uint256[] memory bidSz,
            uint256[] memory askPx,
            uint256[] memory askSz
        ) = oracle.depth(MON, 2);

        assertEq(blockNumber, 12345);
        assertEq(bidPx[0], 2_544_200);
        assertEq(bidSz[0], 376e10);
        assertEq(bidPx[1], 2_535_000);
        assertEq(askPx[0], 2_595_200, "asks resume after the separator");
        assertEq(askSz[0], 100e10);
        assertEq(askPx[1], 2_612_300);
        assertEq(askSz[1], 307e10);
    }
}

/// @notice The same oracle, against the order book Kuru actually has deployed.
/// @dev Skipped unless MONAD_RPC_URL is set, so the suite still runs offline.
contract KuruOracleForkTest is Test {
    address internal constant KURU_MON_AUSD = 0x131A2e70A5b31a517A74b8c567149bc294470Da9;
    bytes32 internal constant MON = keccak256("MON-USD");

    KuruOracle internal oracle;
    bool internal forked;

    function setUp() public {
        string memory url = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(url).length == 0) return;
        try vm.createSelectFork(url) {
            forked = true;
        } catch {
            return;
        }
        oracle = new KuruOracle(address(this));
        oracle.setBook(MON, KURU_MON_AUSD, 2_000, true);
    }

    /// @notice The price XORR settles MON on is the midpoint of real resting orders.
    function test_RealKuruBookPricesTheMarket() public view {
        if (!forked) return;

        (uint256 bid8, uint256 ask8, uint256 mid8, uint256 spreadBps) = oracle.quoteTop(MON);
        assertGt(bid8, 0, "the live book has a bid");
        assertGt(ask8, bid8, "and an ask above it");
        assertEq(mid8, (bid8 + ask8) / 2 + ((bid8 + ask8) % 2 == 0 ? 0 : 0), "mid is the midpoint");
        assertLt(spreadBps, 2_000, "and the spread is inside the guard");

        (uint256 price, uint256 updatedAt) = oracle.latest(MON);
        assertEq(price, mid8);
        assertEq(updatedAt, block.timestamp);

        // MON trades in cents; anything outside this is a decoding mistake, not a move.
        assertGt(price, 100_000, "above $0.001");
        assertLt(price, 100_000_000, "below $1.00");
    }

    function test_RealKuruBookHasDepthOnBothSides() public view {
        if (!forked) return;

        (, uint256[] memory bidPx, uint256[] memory bidSz, uint256[] memory askPx,) =
            oracle.depth(MON, 4);

        assertGt(bidPx[0], 0, "top bid");
        assertGt(bidSz[0], 0, "with size behind it");
        assertGt(askPx[0], bidPx[0], "top ask sits above the top bid");
        assertGt(bidPx[0], bidPx[1], "bids descend");
        assertLt(askPx[0], askPx[1], "asks ascend");
    }
}
