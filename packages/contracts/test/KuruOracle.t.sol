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
