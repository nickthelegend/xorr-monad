// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {RangeMarket} from "../src/RangeMarket.sol";

contract RangeMarketTest is Base {
    function setUp() public {
        setUpBase();
    }

    function _band(uint256 halfBps) internal pure returns (uint128 low, uint128 high) {
        uint256 half = (SPOT * halfBps) / 10_000;
        return (uint128(SPOT - half), uint128(SPOT + half));
    }

    // ------------------------------------------------------------ core loop

    function test_FireOpensTicketAndReservesTheFullPayout() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);

        RangeMarket.Ticket memory t = range.getTicket(id);
        assertEq(t.player, alice);
        assertEq(t.stake, 5e6);
        assertEq(t.multiplierBps, 14_061);
        assertEq(t.payout, (5e6 * 14_061) / 10_000);
        assertEq(t.expiryBlock, uint48(block.number + 100));
        assertEq(t.status, range.STATUS_OPEN());
        assertEq(vault.reserved(), t.payout, "the whole payout is reserved, not the delta");
    }

    /// @notice The desk must never show a number the chain then disagrees with.
    function test_QuotePreviewEqualsWhatFireCharges() public {
        (uint128 low, uint128 high) = _band(10);
        (uint256 previewMult,,) = range.quote(BTC, low, high, T30S);

        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);
        assertEq(range.getTicket(id).multiplierBps, uint32(previewMult));
    }

    function test_SettleInsideBandPaysTheMultiplier() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);

        uint256 before = ausd.balanceOf(alice);
        _roll(100);
        _repush(SPOT + 10e8); // inside the band
        range.settle(id);

        RangeMarket.Ticket memory t = range.getTicket(id);
        assertEq(t.status, range.STATUS_WON());
        assertEq(ausd.balanceOf(alice) - before, t.payout);
        assertEq(vault.reserved(), 0);
    }

    function test_SettleOutsideBandBurnsTheTicket() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);

        uint256 before = ausd.balanceOf(alice);
        uint256 vaultBefore = vault.totalAssets();
        _roll(100);
        _repush(SPOT + 500e8); // well outside

        range.settle(id);
        assertEq(range.getTicket(id).status, range.STATUS_LOST());
        assertEq(ausd.balanceOf(alice), before, "loser gets nothing back");
        assertEq(vault.totalAssets(), vaultBefore, "the stake stays with the LPs");
        assertEq(vault.reserved(), 0);
    }

    /// @notice Expiry is a block height, not a wall clock. Warping time alone must not
    ///         make a ticket settleable.
    function test_CutoffIsABlockNumberNotAClock() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);

        vm.warp(block.timestamp + 1 days); // an hour of clock, zero blocks
        _repush(SPOT);
        vm.expectRevert(abi.encodeWithSelector(RangeMarket.NotExpired.selector, uint48(101), 1));
        range.settle(id);

        vm.roll(block.number + 100);
        _repush(SPOT);
        range.settle(id); // now it goes through
    }

    function test_SettleTwiceReverts() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);
        _roll(100);
        _repush(SPOT);
        range.settle(id);
        vm.expectRevert(RangeMarket.NotOpen.selector);
        range.settle(id);
    }

    // ------------------------------------------------------------- stacking

    /// @notice Stacking mid-round reprices against the shorter remaining horizon: the
    ///         same band is likelier to hold with less time left, so it pays less.
    function test_StackRepricesAgainstTheRemainingBlocks() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 parent = range.fire(BTC, low, high, 5e6, T30S);
        uint32 parentMult = range.getTicket(parent).multiplierBps;

        _roll(10); // 90 blocks left
        _repush(SPOT);

        vm.prank(alice);
        uint64 child = range.stack(parent, 5e6);
        RangeMarket.Ticket memory c = range.getTicket(child);

        assertEq(c.expiryBlock, range.getTicket(parent).expiryBlock, "same cutoff");
        assertEq(c.low, low);
        assertEq(c.high, high);
        assertEq(c.parentId, parent);
        assertLt(c.multiplierBps, parentMult, "less time left is a better bet, so it pays less");
    }

    /// @notice The free-optionality exploit the repricing exists to close. One block
    ///         from the cutoff with the price sitting dead centre, the band is a near
    ///         certainty -- topping up at the parent's original multiplier would be
    ///         minting money. Repriced, it is simply not a sellable bet.
    function test_StackingASureThingAtTheCutoffIsRefused() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 parent = range.fire(BTC, low, high, 5e6, T30S);

        _roll(90); // 10 blocks left, price never moved
        _repush(SPOT);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(RangeMarket.BandTooWide.selector, uint256(9_615), uint256(12_000))
        );
        range.stack(parent, 10e6);
    }

    function test_OnlyTheOwnerOfATicketCanStackOnIt() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 parent = range.fire(BTC, low, high, 5e6, T30S);

        vm.prank(bob);
        vm.expectRevert(RangeMarket.NotParentOwner.selector);
        range.stack(parent, 5e6);
    }

    // ------------------------------------------------------- band + stake gates

    function test_BandWiderThanTheFloorIsNotSellable() public {
        (uint128 low, uint128 high) = _band(30); // ~2.5 sigma, pays under 1.2x
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(RangeMarket.BandTooWide.selector, uint256(9_720), uint256(12_000))
        );
        range.fire(BTC, low, high, 5e6, T30S);
    }

    function test_BandTighterThanTheProbabilityFloorIsRefused() public {
        (uint128 low, uint128 high) = _band(1); // ~6.6% to hold
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(RangeMarket.BandTooTight.selector, uint256(65_778), uint256(125_000))
        );
        range.fire(BTC, low, high, 5e6, T30S);
    }

    function test_SpotMustSitInsideTheBand() public {
        vm.prank(alice);
        vm.expectRevert(RangeMarket.BadBand.selector);
        range.fire(BTC, uint128(SPOT + 1e8), uint128(SPOT + 2e8), 5e6, T30S);
    }

    function test_StakeCapsAreEnforced() public {
        (uint128 low, uint128 high) = _band(12);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(RangeMarket.StakeOutOfRange.selector, 1e6, 10e6));
        range.fire(BTC, low, high, 0.5e6, T30S);
        vm.expectRevert(abi.encodeWithSelector(RangeMarket.StakeOutOfRange.selector, 1e6, 10e6));
        range.fire(BTC, low, high, 11e6, T30S);
        vm.stopPrank();
    }

    function test_RoundTierMustExist() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        vm.expectRevert(RangeMarket.BadTier.selector);
        range.fire(BTC, low, high, 5e6, 99);
    }

    /// @notice The same band is a fair bet over 30 seconds and a near-certainty over 3.
    ///         The market prices each round off its own volatility, so it refuses to
    ///         sell the 3-second version rather than paying 1.4x on a 99.8% lock.
    function test_SameBandIsSellableAtThirtySecondsAndRefusedAtThree() public {
        (uint128 low, uint128 high) = _band(12);

        (uint256 mult30,,) = range.quote(BTC, low, high, T30S);
        assertEq(mult30, 14_061);

        (uint256 mult3, uint256 prob3,) = range.quote(BTC, low, high, T3S);
        assertGt(prob3, 990_000, "over three seconds that band is a lock");
        assertLt(mult3, range.minMultiplierBps(), "and therefore not sellable");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(RangeMarket.BandTooWide.selector, mult3, uint256(12_000))
        );
        range.fire(BTC, low, high, 5e6, T3S);
    }

    /// @notice The 8x ceiling is belt-and-braces. The 12.5% probability gate binds
    ///         first, so the tightest legal band tops out at 7.68x and the cap is
    ///         never the thing that silently shortchanges a winner.
    function test_ProbabilityFloorBindsBeforeTheEightXCap() public {
        uint256 worst = 0;
        for (uint256 halfBps = 2; halfBps <= 40; halfBps++) {
            (uint128 low, uint128 high) = _band(halfBps);
            try range.quote(BTC, low, high, T30S) returns (uint256 m, uint256 p, uint256) {
                if (p >= range.roundConfig(BTC, T30S).minProb1e6 && m >= range.minMultiplierBps() && m > worst) {
                    worst = m;
                }
            } catch {}
        }
        assertGt(worst, 0);
        assertLe(worst, range.maxMultiplierBps(), "no legal band ever needs clamping");
        assertLe(worst, 76_800);
    }

    /// @notice A band described by shape is centred on the print at execution time, so
    ///         a price that moves between reading spot and landing the transaction
    ///         cannot push the band off its own centre. With absolute endpoints that
    ///         race reverts the open; on a 300ms chain it is the common case.
    function test_FireBandCentresOnThePriceAtExecution() public {
        (uint256 spotBefore,, uint256 maxH, uint256 minH) = range.bandLimits(BTC, T30S);
        uint32 half = uint32((maxH + minH) / 2);

        // The market moves after the player decided, before the transaction lands.
        oracle.push(BTC, spotBefore + (spotBefore * 30) / 10_000); // +0.30%

        vm.prank(alice);
        uint64 id = range.fireBand(BTC, half, half, 1e6, T30S);

        RangeMarket.Ticket memory t = range.getTicket(id);
        (uint256 spotNow,) = oracle.latest(BTC);
        assertGt(t.low, 0);
        assertLt(t.low, spotNow, "band must sit under the new print");
        assertGt(t.high, spotNow, "band must sit over the new print");
    }

    /// @notice The same move breaks an absolute-endpoint open, which is why fireBand
    ///         exists. Documented as a test so the race cannot quietly come back.
    function test_AbsoluteEndpointsLoseTheRaceWhenPriceMoves() public {
        (uint256 spot,, uint256 maxH, uint256 minH) = range.bandLimits(BTC, T30S);
        uint256 half = (spot * ((maxH + minH) / 2)) / 1e8;
        uint128 low = uint128(spot - half);
        uint128 high = uint128(spot + half);

        oracle.push(BTC, spot + (spot * 30) / 10_000); // +0.30%, outside the painted band

        vm.prank(alice);
        vm.expectRevert(RangeMarket.BadBand.selector);
        range.fire(BTC, low, high, 1e6, T30S);
    }

    /// @notice Whatever the painter is allowed to draw, the chain must accept —
    ///         including both exact endpoints, which is where a truncated conversion
    ///         from z to a half-width used to put the band one unit outside the
    ///         sellable window and make the tightest clamp unfireable.
    function test_BandLimitsRoundTripIntoAFireableTicket() public {
        (uint256 spot,, uint256 maxHalf1e4, uint256 minHalf1e4) = range.bandLimits(BTC, T30S);
        assertGt(maxHalf1e4, minHalf1e4);

        uint256 step = (maxHalf1e4 - minHalf1e4) / 12;
        for (uint256 h = minHalf1e4; h <= maxHalf1e4; h += step) {
            uint256 half = (spot * h) / 1e8; // h is 1e4-scaled bps
            vm.prank(alice);
            range.fire(BTC, uint128(spot - half), uint128(spot + half), 1e6, T30S);
        }
    }

    /**
     * @notice No round may sell a band narrower than the first measured knot.
     *
     * The table is sampled every 0.25 sigma. Below that the contract interpolates
     * between "the price did not move at all" and the first real observation, and that
     * line is not a measurement — measured against real tape the tightest band a
     * three-second round would otherwise allow modelled a 33% chance where the true
     * rate was 59%, and paid 2.9x on it.
     */
    function test_NoRoundSellsInsideTheFirstMeasuredKnot() public view {
        for (uint8 tier = 0; tier < 6; tier++) {
            (, uint256 sig1e4,, uint256 minH) = range.bandLimits(BTC, tier);
            assertGe(minH, sig1e4 / 4, "band opened inside the first knot");
        }
    }

    /// @notice The exact endpoints, on every round. A painter that clamps to a value
    ///         the market rejects is a UI that lies about what it is offering.
    function test_EveryRoundsBandLimitsAreFireableAtBothEnds() public {
        for (uint8 tier = 0; tier < 6; tier++) {
            (uint256 spot,, uint256 maxH, uint256 minH) = range.bandLimits(BTC, tier);
            assertGt(minH, 0, "tightest band collapsed to zero width");
            assertGt(maxH, minH, "empty band window");

            uint256 tight = (spot * minH) / 1e8;
            vm.prank(alice);
            range.fire(BTC, uint128(spot - tight), uint128(spot + tight), 1e6, tier);

            uint256 wide = (spot * maxH) / 1e8;
            vm.prank(alice);
            range.fire(BTC, uint128(spot - wide), uint128(spot + wide), 1e6, tier);
        }
    }

    /// @notice A 10-block round is the shortest XORR sells and the whole legal band is
    ///         under 5 bps wide. Whole-bps limits would round the painter's floor to
    ///         zero and its ceiling to four steps.
    function test_ShortRoundBandLimitsStaySubBps() public {
        (,, uint256 maxHalf1e4, uint256 minHalf1e4) = range.bandLimits(BTC, T3S);
        assertLt(maxHalf1e4, 5e4, "under 5 bps");
        assertGt(minHalf1e4, 0, "and still resolvable");
        assertGt(maxHalf1e4, minHalf1e4);
    }

    // ----------------------------------------------------------- oracle health

    function test_StalePrintInsideTheWindowAsksTheKeeperToTryAgain() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);

        _roll(100);
        vm.warp(block.timestamp + 120); // print is now well over 30s old
        vm.expectRevert();
        range.settle(id);
    }

    /// @notice A dead feed must never trap a user's money. Past the settle window the
    ///         ticket voids and the stake goes home.
    function test_DeadFeedPastTheWindowVoidsAndRefunds() public {
        (uint128 low, uint128 high) = _band(12);
        vm.prank(alice);
        uint64 id = range.fire(BTC, low, high, 5e6, T30S);
        uint256 before = ausd.balanceOf(alice);

        vm.roll(block.number + 100 + range.settleWindowBlocks() + 1);
        vm.warp(block.timestamp + 1 days); // feed never printed again

        range.settle(id);
        assertEq(range.getTicket(id).status, range.STATUS_VOID());
        assertEq(ausd.balanceOf(alice) - before, 5e6, "stake refunded in full");
        assertEq(vault.reserved(), 0);
    }

    // ------------------------------------------------------------------ batch

    function test_SettleBatchIsCapped() public {
        uint64[] memory ids = new uint64[](21);
        vm.expectRevert(RangeMarket.BatchTooLarge.selector);
        range.settleBatch(ids);
    }

    function test_SettleBatchClearsTwentyTickets() public {
        (uint128 low, uint128 high) = _band(12);
        uint64[] memory ids = new uint64[](20);
        vm.startPrank(alice);
        for (uint256 i = 0; i < 20; i++) {
            ids[i] = range.fire(BTC, low, high, 1e6, T30S);
        }
        vm.stopPrank();

        _roll(100);
        _repush(SPOT);
        uint8[] memory out = range.settleBatch(ids);
        for (uint256 i = 0; i < 20; i++) {
            assertEq(out[i], range.STATUS_WON());
        }
        assertEq(vault.reserved(), 0);
    }
}
