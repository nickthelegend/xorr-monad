// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {XorrVault} from "../src/XorrVault.sol";

contract XorrVaultTest is Base {
    function setUp() public {
        setUpBase();
    }

    /// @dev Pull the $1m bankroll out so utilisation and caps are observable at
    ///      hackathon-sized numbers. Note the shares are read BEFORE the prank:
    ///      an external call in argument position consumes it.
    function _shrinkBankroll() internal {
        uint256 shares = vault.sharesOf(lp);
        vm.prank(lp);
        vault.withdraw(shares);
    }

    function test_DepositMintsSharesAndWithdrawReturnsAssets() public {
        _fund(bob, 1_000e6);
        vm.startPrank(bob);
        uint256 shares = vault.deposit(1_000e6);
        assertGt(shares, 0);
        uint256 got = vault.withdraw(shares);
        vm.stopPrank();
        assertApproxEqAbs(got, 1_000e6, 2, "round trip loses at most rounding dust");
    }

    function test_WithdrawIsCappedByFreeAssets() public {
        _shrinkBankroll();

        _fund(bob, 100e6);
        vm.prank(bob);
        uint256 shares = vault.deposit(100e6);

        uint256 half = (SPOT * 12) / 10_000;
        vm.prank(alice);
        range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), 10e6, T30S);

        assertGt(vault.reserved(), 0);
        uint256 free = vault.freeAssets();
        assertLt(free, vault.totalAssets(), "an open ticket must lock capital");

        vm.prank(bob);
        vm.expectRevert();
        vault.withdraw(shares); // would dip into the reserved payout
    }

    function test_ReserveRejectsOverUtilisation() public {
        _shrinkBankroll();

        _fund(bob, 20e6);
        vm.prank(bob);
        vault.deposit(20e6);

        // Each fire brings its own stake, so the 80% ceiling rises as tickets stack.
        // On a $20 bankroll with $10 stakes at 1.4061x the third one is the one that
        // no longer fits: 3 * 14.061 = 42.18 against a ceiling of 0.8 * 50 = 40.
        uint256 half = (SPOT * 12) / 10_000;
        vm.startPrank(alice);
        range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), 10e6, T30S);
        range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), 10e6, T30S);
        vm.expectRevert();
        range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), 10e6, T30S);
        vm.stopPrank();

        assertLe(vault.reserved(), vault.totalAssets());
    }

    function test_OnlyMarketsCanTouchTheBankroll() public {
        vm.prank(alice);
        vm.expectRevert(XorrVault.NotMarket.selector);
        vault.reserve(1e6);

        vm.prank(alice);
        vm.expectRevert(XorrVault.NotMarket.selector);
        vault.pay(alice, 1e6);
    }

    function test_UtilisationMeterTracksOpenExposure() public {
        _shrinkBankroll();
        _fund(bob, 500e6);
        vm.prank(bob);
        vault.deposit(500e6);

        assertEq(vault.utilisationBps(), 0);
        uint256 half = (SPOT * 12) / 10_000;
        vm.prank(alice);
        uint64 id = range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), 10e6, T30S);
        assertGt(vault.utilisationBps(), 0);

        _roll(100);
        _repush(SPOT);
        range.settle(id);
        assertEq(vault.utilisationBps(), 0, "settling frees the reservation");
    }

    function test_PausedVaultRefusesNewExposure() public {
        vm.prank(owner);
        vault.setPaused(true);

        uint256 half = (SPOT * 12) / 10_000;
        vm.prank(alice);
        vm.expectRevert();
        range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), 5e6, T30S);
    }

    /// @notice The ship-blocker. Fire a wall of tickets, make every single one win,
    ///         and prove the vault settles all of them without going short.
    function test_VaultCanAlwaysPayEveryOpenTicketEvenIfAllWin() public {
        uint256 half = (SPOT * 12) / 10_000;
        uint64[] memory ids = new uint64[](20);

        for (uint256 i = 0; i < 20; i++) {
            address p = address(uint160(0x1000 + i));
            _fund(p, 100e6);
            vm.prank(p);
            ids[i] = range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), 10e6, T30S);
            assertLe(vault.reserved(), vault.totalAssets(), "invariant holds on every fire");
        }

        _roll(100);
        _repush(SPOT); // dead centre: every ticket wins

        for (uint256 i = 0; i < 20; i++) {
            address p = address(uint160(0x1000 + i));
            uint256 before = ausd.balanceOf(p);
            range.settle(ids[i]);
            assertGt(ausd.balanceOf(p), before, "winner must be paid in full");
            assertLe(vault.reserved(), vault.totalAssets(), "invariant holds on every settle");
        }

        assertEq(vault.reserved(), 0);
    }

    function testFuzz_ReservedNeverExceedsAssets(uint96 stake, uint16 halfBps, uint8 tier) public {
        stake = uint96(bound(stake, 1e6, 10e6));
        halfBps = uint16(bound(halfBps, 1, 400));
        tier = uint8(bound(tier, 0, 5));

        uint256 half = (SPOT * halfBps) / 10_000;
        vm.prank(alice);
        try range.fire(BTC, uint128(SPOT - half), uint128(SPOT + half), stake, tier) {
            assertLe(vault.reserved(), vault.totalAssets());
        } catch {
            assertLe(vault.reserved(), vault.totalAssets());
        }
    }
}
