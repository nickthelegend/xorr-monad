// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pricing} from "../src/lib/Pricing.sol";

contract PricingTest is Test {
    uint256 constant SPOT = 100_000e8;

    function N() internal pure returns (uint32[17] memory) {
        return Pricing.normalTable();
    }

    /// @dev Test helper: the old single-vol + sqrt-scaling path, kept so every
    ///      expectation below stays hand-checkable against the textbook normal.
    function q(uint256 low, uint256 high, uint256 blocks_, uint256 vol, uint256 edge)
        internal
        pure
        returns (uint256 mult, uint256 prob)
    {
        return Pricing.quote(N(), SPOT, low, high, Pricing.sigmaBps1e4(vol, blocks_, 100), edge);
    }

    function test_TableIsMonotonicAndBounded() public pure {
        uint256 prev = 0;
        for (uint256 z = 0; z <= 45_000; z += 250) {
            uint256 t = Pricing.halfProb(N(), z);
            assertGe(t, prev, "T(z) must be non-decreasing");
            assertLe(t, 1e6, "T(z) must be a probability");
            prev = t;
        }
        assertEq(Pricing.halfProb(N(), 0), 0);
        // Beyond 4 sigma the table returns its own terminal value, not a hardcoded 1.0.
        // A measured distribution need not have reached certainty by 4 sigma, and
        // pretending otherwise would quietly overstate how safe a wide band is.
        assertEq(Pricing.halfProb(N(), Pricing.Z_MAX), 999_937);
    }

    /// @dev Spot values of 2*Phi(z)-1 the table has to reproduce.
    function test_TableMatchesNormalAtKnots() public pure {
        assertEq(Pricing.halfProb(N(), 10_000), 682_689); // 1 sigma
        assertEq(Pricing.halfProb(N(), 20_000), 954_500); // 2 sigma
        assertEq(Pricing.halfProb(N(), 30_000), 997_300); // 3 sigma
    }

    function test_SigmaScalesWithSqrtOfTime() public pure {
        // 4x the blocks must be exactly 2x the sigma. Sigma is 1e4-scaled bps.
        uint256 s100 = Pricing.sigmaBps1e4(12, 100, 100);
        uint256 s400 = Pricing.sigmaBps1e4(12, 400, 100);
        assertEq(s100, 12 * 1e4);
        assertEq(s400, 24 * 1e4);
    }

    /// @notice The precision that whole-bps sigma used to throw away. A 10-block round
    ///         is 0.3162 sigma-scales of a 100-block one; truncating 3.7944 bps to 3
    ///         would misprice the shortest -- and most characteristic -- XORR round by
    ///         over 20%.
    function test_ShortHorizonSigmaKeepsSubBpsPrecision() public pure {
        assertEq(Pricing.sigmaBps1e4(12, 10, 100), 37_944);
        assertEq(Pricing.sigmaBps1e4(12, 10, 100) / 1e4, 3); // what the old rounding gave
    }

    function test_SymmetricOneSigmaBandPricesAt1_41x() public pure {
        uint256 half = (SPOT * 12) / 10_000; // 1 sigma in price terms
        (uint256 mult, uint256 p) = q(SPOT - half, SPOT + half, 100, 12, 400);
        assertEq(p, 682_689);
        assertEq(mult, 14_061); // 1/0.68269 * 0.96, truncated
    }

    /// @notice The test that kills the "narrower band = bigger multiplier" heuristic.
    ///         A band pinned at spot on one edge and open on the other is a coin flip.
    ///         A width rule keyed off the nearest edge would price this at the 8x cap
    ///         and hand the vault a 4x-negative-EV ticket on every fire.
    function test_BandPinnedAtSpotIsPricedAsACoinFlip() public pure {
        (uint256 mult, uint256 p) = q(SPOT - 1, SPOT * 2, 100, 12, 400);
        // (T(0) + T(4 sigma)) / 2 = (0 + 999937) / 2, i.e. a coin flip to within the
        // table's own tail resolution.
        assertEq(p, 499_968, "one edge at spot is a coin flip");
        assertEq(mult, 19_200, "1.92x, not the 8.00x a nearest-edge rule would pay");
    }

    function test_WiderBandNeverPaysMoreThanTighterBand() public pure {
        uint256 prevMult = type(uint256).max;
        for (uint256 halfBps = 5; halfBps <= 200; halfBps += 5) {
            uint256 half = (SPOT * halfBps) / 10_000;
            (uint256 mult,) = q(SPOT - half, SPOT + half, 100, 12, 400);
            assertLe(mult, prevMult, "multiplier must fall as the band widens");
            prevMult = mult;
        }
    }

    function test_LongerHorizonPaysMoreForTheSameBand() public pure {
        uint256 half = (SPOT * 12) / 10_000;
        (uint256 m10,) = q(SPOT - half, SPOT + half, 10, 12, 400);
        (uint256 m100,) = q(SPOT - half, SPOT + half, 100, 12, 400);
        (uint256 m400,) = q(SPOT - half, SPOT + half, 400, 12, 400);
        assertLt(m10, m100);
        assertLt(m100, m400);
    }

    function test_HouseEdgeIsAlwaysTakenOffTheFairPrice() public pure {
        uint256 half = (SPOT * 20) / 10_000;
        (uint256 withEdge, uint256 p) = q(SPOT - half, SPOT + half, 100, 12, 400);
        (uint256 noEdge,) = q(SPOT - half, SPOT + half, 100, 12, 0);
        assertEq(noEdge, (1e6 * 10_000) / p, "zero edge must equal the fair price 1/p");
        assertEq(withEdge, (noEdge * 9_600) / 10_000);
        assertLt(withEdge, noEdge);
    }

    /// @notice The property that makes the vault's edge structural: expected payout per
    ///         unit staked is (1 - edge), strictly below 1, for every legal band.
    function testFuzz_ExpectedValueIsAlwaysBelowOne(uint256 lowBps, uint256 highBps, uint256 blocks_)
        public
        pure
    {
        lowBps = bound(lowBps, 3, 400);
        highBps = bound(highBps, 3, 400);
        blocks_ = bound(blocks_, 10, 6_000);

        uint256 low = SPOT - (SPOT * lowBps) / 10_000;
        uint256 high = SPOT + (SPOT * highBps) / 10_000;

        (uint256 mult, uint256 p) = q(low, high, blocks_, 12, 400);

        // EV per 1e6 staked = p * mult / BPS
        uint256 ev = (p * mult) / 10_000;
        assertLe(ev, 1e6, "a ticket must never be positive-EV against the vault");
    }

    // ------------------------------------------------- calibrated distributions

    /// @dev A stand-in for a measured short-round table: a third of three-second rounds
    ///      close exactly where they opened, which is a point mass at zero that no
    ///      normal can represent.
    function measuredShortRound() internal pure returns (uint32[17] memory t) {
        t = [
            uint32(334_250), 670_867, 730_987, 786_356, 830_708, 868_860, 898_895, 924_146,
            941_130, 953_781, 964_448, 972_165, 977_649, 982_349, 985_799, 988_799, 990_416
        ];
    }

    function test_MeasuredTableBeatsTheNormalAtTheOrigin() public pure {
        assertEq(Pricing.halfProb(N(), 0), 0, "a normal never sits still");
        assertEq(Pricing.halfProb(measuredShortRound(), 0), 334_250, "real tape does, a third of the time");
    }

    /// @notice The same band priced off a measured distribution versus a normal. The
    ///         normal thinks the band is far less likely to hold and pays out for it.
    ///         Over a three-second round that difference is the vault's whole margin.
    function test_NormalOverpaysAgainstAMeasuredShortRound() public pure {
        uint256 half = (SPOT * 12) / 10_000;
        uint256 sig = Pricing.sigmaBps1e4(12, 100, 100);

        (uint256 normalMult, uint256 normalP) =
            Pricing.quote(N(), SPOT, SPOT - half, SPOT + half, sig, 400);
        (uint256 realMult, uint256 realP) =
            Pricing.quote(measuredShortRound(), SPOT, SPOT - half, SPOT + half, sig, 400);

        assertGt(realP, normalP, "the band actually holds more often than a normal says");
        assertLt(realMult, normalMult, "so the honest multiplier is lower");

        // Paying the normal's price against the real win rate is a losing book.
        assertGt((realP * normalMult) / 1e6, 10_000, "normal pricing is negative-EV for the vault");
        assertLe((realP * realMult) / 1e6, 10_000, "measured pricing is not");
    }

    function test_TableValidationRejectsANonCdf() public {
        uint32[17] memory bad = N();
        bad[5] = 1; // dips below its predecessor
        vm.expectRevert(Pricing.TableNotMonotonic.selector);
        this.validate(bad);

        uint32[17] memory tooBig = N();
        tooBig[16] = 2_000_000; // probability above one
        vm.expectRevert(Pricing.TableNotMonotonic.selector);
        this.validate(tooBig);
    }

    function validate(uint32[17] memory t) external pure {
        Pricing.validateTable(t);
    }

    function test_ValidTablesPass() public view {
        this.validate(N());
        this.validate(measuredShortRound());
    }
}
