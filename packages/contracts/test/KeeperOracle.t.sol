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
