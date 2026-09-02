// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title XORR band pricing
/// @notice The multiplier a band earns is published, deterministic, and identical
///         on-chain and in the UI (packages/sdk mirrors this file line for line).
///
///         A ticket wins when the settlement print lands inside [low, high]. Settlement
///         reads a single print at the cutoff block, so the payoff is European, not a
///         barrier: only where price *ends up* matters.
///
///         For ANY symmetric return distribution with CDF F, writing
///         T(z) = P(|move| <= z*sigma) = 2F(z) - 1:
///
///             P(inside) = F(zHigh) - F(-zLow) = ( T(zLow) + T(zHigh) ) / 2
///
///         with zLow = (spot-low)/sigma and zHigh = (high-spot)/sigma. That identity is
///         exact, not an approximation, and it is why XORR prices asymmetric bands
///         correctly: a band pinned at spot on one side (zLow = 0) collapses to P = 0.5
///         and pays ~1.9x, instead of the ~8x a "narrower band pays more" width rule
///         would hand out on a coin flip.
///
///         T is supplied by the CALLER as a 17-point table on z in [0, 4], interpolated
///         linearly. It is not hardcoded to the normal distribution, because the normal
///         does not survive contact with the tape. Measured on real BTC, one-second
///         returns carry excess kurtosis near 70, and over a three-second round the
///         price is completely unchanged about a THIRD of the time -- a point mass at
///         zero that no normal can express (a normal has T(0) = 0; the measured value
///         is 0.334). Pricing that round off a normal understates how often a band
///         holds, inflates the multiplier, and drains the vault on the shortest rounds,
///         which are the whole reason to build this on a 300ms chain.
///
///         So each market carries its own measured T table, fitted offline from real
///         tape by packages/sdk/src/termstructure.ts. `normalTable()` remains the
///         default for markets with no calibration yet.
library Pricing {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PROB_ONE = 1e6; // probabilities are 1e6 fixed point
    uint256 internal constant Z_STEP = 2500; // 0.25 sigma, in 1e4 fixed point
    uint256 internal constant Z_MAX = 40_000; // 4.00 sigma
    uint256 internal constant TABLE_LEN = 17;

    error ZeroSigma();
    error SpotOutsideBand();
    error TableNotMonotonic();

    /// @notice T(z) = 2*Phi(z) - 1 for the standard normal, on the same 0.25 grid.
    /// @dev The fallback for an uncalibrated market. Deliberately conservative to use
    ///      only where real tape has not been measured yet.
    function normalTable() internal pure returns (uint32[17] memory t) {
        t = [
            uint32(0), // z = 0.00
            197_413, // 0.25
            382_925, // 0.50
            546_746, // 0.75
            682_689, // 1.00
            788_700, // 1.25
            866_386, // 1.50
            919_882, // 1.75
            954_500, // 2.00
            975_551, // 2.25
            987_581, // 2.50
            994_040, // 2.75
            997_300, // 3.00
            998_845, // 3.25
            999_535, // 3.50
            999_823, // 3.75
            999_937 // 4.00
        ];
    }

    /// @notice A distribution table is only usable if it is a real CDF: non-decreasing
    ///         and bounded by one. Checked once when a market is configured.
    function validateTable(uint32[17] memory t) internal pure {
        uint256 prev = 0;
        for (uint256 i = 0; i < TABLE_LEN; i++) {
            if (t[i] < prev || t[i] > PROB_ONE) revert TableNotMonotonic();
            prev = t[i];
        }
    }

    /// @notice T(z) interpolated from the supplied table. z is 1e4 fp, result is 1e6 fp.
    function halfProb(uint32[17] memory t, uint256 z1e4) internal pure returns (uint256) {
        if (z1e4 >= Z_MAX) return t[TABLE_LEN - 1];
        uint256 i = z1e4 / Z_STEP;
        uint256 rem = z1e4 - (i * Z_STEP);
        uint256 lo = t[i];
        uint256 hi = t[i + 1];
        return lo + ((hi - lo) * rem) / Z_STEP;
    }

    /// @notice Babylonian integer square root.
    function sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x >> 1) + 1;
        while (y < z) {
            z = y;
            y = (x / y + y) >> 1;
        }
    }

    /// @notice Scale a reference-horizon sigma by sqrt(time).
    /// @dev Only used to interpolate between calibrated round tiers and by the
    ///      calibration tooling. The sellable rounds each carry a measured sigma, so
    ///      the pricing path never relies on sqrt-scaling holding at short horizons --
    ///      measured on real tape, it does not.
    function sigmaBps1e4(uint256 volBps, uint256 blocks_, uint256 refBlocks)
        internal
        pure
        returns (uint256)
    {
        return volBps * sqrt((blocks_ * 1e8) / refBlocks);
    }

    /// @notice Probability the cutoff print lands inside [low, high]. 1e6 fixed point.
    /// @param sig1e4 one-sigma move in bps of spot, scaled by 1e4
    function probInside(
        uint32[17] memory t,
        uint256 spot,
        uint256 low,
        uint256 high,
        uint256 sig1e4
    ) internal pure returns (uint256) {
        if (sig1e4 == 0) revert ZeroSigma();
        if (low >= spot || high <= spot) revert SpotOutsideBand();

        // Edge distances as a fraction of spot at 1e8, divided by a 1e4-scaled
        // sigma-in-bps, which lands z at 1e4 fixed point.
        uint256 zLow = ((spot - low) * 1e8) / spot * BPS / sig1e4;
        uint256 zHigh = ((high - spot) * 1e8) / spot * BPS / sig1e4;

        return (halfProb(t, zLow) + halfProb(t, zHigh)) / 2;
    }

    /// @notice The multiplier XORR offers for a band, in bps (10_000 = 1.00x).
    /// @dev gross = 1/p, then the house edge comes off. No clamping happens here:
    ///      RangeMarket rejects bands outside the sellable window rather than clamping
    ///      a multiplier up to a floor the vault would then have to fund.
    function quote(
        uint32[17] memory t,
        uint256 spot,
        uint256 low,
        uint256 high,
        uint256 sig1e4,
        uint256 houseEdgeBps
    ) internal pure returns (uint256 multiplierBps, uint256 prob1e6) {
        prob1e6 = probInside(t, spot, low, high, sig1e4);
        if (prob1e6 == 0) return (type(uint256).max, 0);
        uint256 gross = (PROB_ONE * BPS) / prob1e6;
        multiplierBps = (gross * (BPS - houseEdgeBps)) / BPS;
    }
}
