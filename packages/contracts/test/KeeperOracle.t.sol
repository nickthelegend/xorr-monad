// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KeeperOracle} from "../src/oracles/KeeperOracle.sol";

contract KeeperOracleTest is Test {
    KeeperOracle internal oracle;
    address internal owner = address(0xA11CE);
    address internal keeper = address(0xC0FFEE);
    address internal stranger = address(0xBAD);

    bytes32 internal constant BTC = keccak256("BTC-USD");
    bytes32 internal constant ETH = keccak256("ETH-USD");

    function setUp() public {
        oracle = new KeeperOracle(owner);
        vm.prank(owner);
        oracle.setUpdater(keeper, true);
    }

    function test_StartsEmptySoNoMarketCanOpenOnAnInventedPrice() public view {
        assertFalse(oracle.hasMarket(BTC));
        (uint256 p, uint256 t) = oracle.latest(BTC);
        assertEq(p, 0);
        assertEq(t, 0);
    }

    function test_PushRecordsPriceTimeAndRound() public {
        vm.warp(1_700_000_000);
        vm.prank(keeper);
        oracle.push(BTC, 77_000e8);

        (uint256 p, uint256 t) = oracle.latest(BTC);
        assertEq(p, 77_000e8);
        assertEq(t, 1_700_000_000, "a print must carry when it was observed");
        assertEq(oracle.latestRound(BTC).roundId, 1);
        assertTrue(oracle.hasMarket(BTC));
    }

    function test_OnlyAnUpdaterCanPush() public {
        vm.prank(stranger);
        vm.expectRevert(KeeperOracle.NotUpdater.selector);
        oracle.push(BTC, 77_000e8);
    }

    function test_ZeroPriceIsRefused() public {
        vm.prank(keeper);
        vm.expectRevert(KeeperOracle.ZeroPrice.selector);
        oracle.push(BTC, 0);
    }

    /// @notice A compromised or malfunctioning keeper must not be able to teleport the
    ///         price — that is exactly how a range market gets drained.
    function test_DeviationGuardRejectsATeleport() public {
        vm.startPrank(keeper);
        oracle.push(BTC, 77_000e8);
        vm.expectRevert(
            abi.encodeWithSelector(
                KeeperOracle.DeviationTooLarge.selector, uint256(77_000e8), uint256(1e8), uint256(1_000)
            )
        );
        oracle.push(BTC, 1e8);
        vm.stopPrank();
    }

    function test_MovesInsideTheGuardAreAccepted() public {
        vm.startPrank(keeper);
        oracle.push(BTC, 77_000e8);
        oracle.push(BTC, 79_000e8); // +2.6%
        vm.stopPrank();
        (uint256 p,) = oracle.latest(BTC);
        assertEq(p, 79_000e8);
    }

    function test_OwnerCanRebasePastTheGuard() public {
        vm.prank(keeper);
        oracle.push(BTC, 77_000e8);

        vm.prank(owner);
        oracle.rebase(BTC, 1_000e8);

        (uint256 p,) = oracle.latest(BTC);
        assertEq(p, 1_000e8);
        assertEq(oracle.latestRound(BTC).roundId, 2);
    }

    function test_RebaseIsOwnerOnly() public {
        vm.prank(keeper);
        vm.expectRevert();
        oracle.rebase(BTC, 1_000e8);
    }

    /**
     * The exact sequence tools/keeper.mjs performs when it comes back after a gap.
     *
     * A keeper that has been down long enough for the market to move will find its
     * first batch rejected by the deviation guard, because from the chain's point of
     * view a large jump is indistinguishable from a compromised key. The recovery is a
     * deliberate owner re-base, not a widened guard — and until now that was a comment
     * in the keeper explaining what it does, with nothing asserting the sequence
     * actually works end to end. A restart that cannot recover is a keeper that stays
     * down.
     */
    function test_KeeperRecoversFromAGapByRebasing() public {
        vm.warp(1_700_000_000);
        vm.prank(keeper);
        oracle.push(BTC, 77_000e8);

        // Down for an hour; the market moved far more than one step of the guard allows.
        vm.warp(block.timestamp + 3_600);
        uint256 movedTo = 96_000e8;

        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory px = new uint256[](1);
        ids[0] = BTC;
        px[0] = movedTo;

        vm.prank(keeper);
        vm.expectRevert();
        oracle.pushBatch(ids, px);

        // The stale print is still there — a rejected push must not corrupt it.
        (uint256 held,) = oracle.latest(BTC);
        assertEq(held, 77_000e8, "a refused push must leave the last good print alone");

        // What the keeper does next.
        vm.prank(owner);
        oracle.rebase(BTC, movedTo);

        (uint256 p, uint256 t) = oracle.latest(BTC);
        assertEq(p, movedTo, "re-base adopts the real price");
        assertEq(t, block.timestamp, "and it is fresh, so settlement can resume");

        // And normal publishing resumes from the new level without further intervention.
        vm.warp(block.timestamp + 2);
        px[0] = movedTo + 10e8;
        vm.prank(keeper);
        oracle.pushBatch(ids, px);

        (uint256 after_,) = oracle.latest(BTC);
        assertEq(after_, movedTo + 10e8, "the keeper is publishing again");
    }

    function test_BatchPushCoversEveryMarketInOneTx() public {
        bytes32[] memory ids = new bytes32[](2);
        uint256[] memory px = new uint256[](2);
        ids[0] = BTC;
        ids[1] = ETH;
        px[0] = 77_000e8;
        px[1] = 2_600e8;

        vm.prank(keeper);
        oracle.pushBatch(ids, px);

        (uint256 b,) = oracle.latest(BTC);
        (uint256 e,) = oracle.latest(ETH);
        assertEq(b, 77_000e8);
        assertEq(e, 2_600e8);
    }

    function test_BatchLengthMismatchReverts() public {
        bytes32[] memory ids = new bytes32[](2);
        uint256[] memory px = new uint256[](1);
        vm.prank(keeper);
        vm.expectRevert(KeeperOracle.LengthMismatch.selector);
        oracle.pushBatch(ids, px);
    }

    function test_UpdaterCanBeRevoked() public {
        vm.prank(owner);
        oracle.setUpdater(keeper, false);
        vm.prank(keeper);
        vm.expectRevert(KeeperOracle.NotUpdater.selector);
        oracle.push(BTC, 77_000e8);
    }
}
