// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE - do not edit by hand.
/// @dev Produced by `pnpm calibrate` from real market tape.
///      Generated: 2026-09-03T02:42:37.375Z
///
///      Each market carries a MEASURED return distribution per round length,
///      not an assumed normal. Over a three-second round BTC does not move at
///      all a large fraction of the time; a normal puts zero probability there.
///      Sigma is fitted on the most recent tape and shaded down, and each
///      round's multiplier ceiling is solved by walk-forward, so the vault
///      stays ahead between keeper re-marks.
library CalibratedMarkets {
    uint256 internal constant MARKET_COUNT = 3;
    uint256 internal constant ROUND_COUNT = 6;

    function roundBlocks() internal pure returns (uint32[] memory r) {
        r = new uint32[](6);
        r[0] = 10; // ~3s at 300ms
        r[1] = 33; // ~10s at 300ms
        r[2] = 100; // ~30s at 300ms
        r[3] = 333; // ~100s at 300ms
        r[4] = 1000; // ~300s at 300ms
        r[5] = 3000; // ~900s at 300ms
    }

    // ---- BTC-USD (binance:BTCUSDT 1s)
    function marketId0() internal pure returns (bytes32) {
        return 0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e; // keccak256("BTC-USD")
    }

    function enabled0() internal pure returns (bool) {
        return true;
    }

    function sigma1e4_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 3573;
        s[1] = 11161;
        s[2] = 21535;
        s[3] = 39095;
        s[4] = 78207;
        s[5] = 134221;
    }

    function minProb1e6_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 370084;
        s[1] = 192881;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 25940;
        s[1] = 49772;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables0() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(350084), 705193, 753769, 800670, 840871, 871022, 899497, 919598, 938023, 953099, 963149, 973199, 978224, 983250, 986600, 989950, 991625];
        t[1] = [uint32(172881), 450847, 579661, 684746, 766102, 830508, 877966, 915254, 942373, 959322, 972881, 979661, 986441, 993220, 996610, 1000000, 1000000];
        t[2] = [uint32(36585), 280488, 463415, 609756, 719512, 804878, 865854, 914634, 951220, 975610, 987805, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[3] = [uint32(0), 222222, 416667, 583333, 694444, 805556, 861111, 916667, 944444, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[4] = [uint32(0), 222222, 416667, 583333, 694444, 805556, 861111, 916667, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[5] = [uint32(0), 166667, 361111, 555556, 694444, 777778, 888889, 944444, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
    }

    // ---- ETH-USD (binance:ETHUSDT 1s)
    function marketId1() internal pure returns (bytes32) {
        return 0x2430f68ea2e8d4151992bb7fc3a4c472087a6149bf7e0232704396162ab7c1f7; // keccak256("ETH-USD")
    }

    function enabled1() internal pure returns (bool) {
        return true;
    }

    function sigma1e4_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 5448;
        s[1] = 16524;
        s[2] = 29511;
        s[3] = 51540;
        s[4] = 101222;
        s[5] = 178456;
    }

    function minProb1e6_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 346633;
        s[1] = 135254;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 27695;
        s[1] = 70978;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables1() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(326633), 631491, 693467, 758794, 810720, 857621, 892797, 921273, 944724, 959799, 969849, 978224, 983250, 986600, 989950, 991625, 994975];
        t[1] = [uint32(115254), 362712, 522034, 657627, 752542, 823729, 877966, 918644, 942373, 962712, 976271, 986441, 993220, 996610, 1000000, 1000000, 1000000];
        t[2] = [uint32(12195), 256098, 426829, 585366, 707317, 804878, 878049, 914634, 951220, 975610, 987805, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[3] = [uint32(0), 222222, 388889, 555556, 694444, 777778, 861111, 916667, 944444, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[4] = [uint32(0), 194444, 416667, 555556, 694444, 805556, 888889, 916667, 972222, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[5] = [uint32(0), 222222, 416667, 611111, 722222, 805556, 888889, 916667, 972222, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
    }

    // ---- MON-USD (kuru:MON-AUSD (mark only)) -- PAPER ONLY, not funded
    function marketId2() internal pure returns (bytes32) {
        return 0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62; // keccak256("MON-USD")
    }

    function enabled2() internal pure returns (bool) {
        return false;
    }

    function sigma1e4_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 13620;
        s[1] = 41310;
        s[2] = 73778;
        s[3] = 128850;
        s[4] = 253055;
        s[5] = 446140;
    }

    function minProb1e6_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 346633;
        s[1] = 135254;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 27695;
        s[1] = 70978;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables2() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(326633), 631491, 693467, 758794, 810720, 857621, 892797, 921273, 944724, 959799, 969849, 978224, 983250, 986600, 989950, 991625, 994975];
        t[1] = [uint32(115254), 362712, 522034, 657627, 752542, 823729, 877966, 918644, 942373, 962712, 976271, 986441, 993220, 996610, 1000000, 1000000, 1000000];
        t[2] = [uint32(12195), 256098, 426829, 585366, 707317, 804878, 878049, 914634, 951220, 975610, 987805, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[3] = [uint32(0), 222222, 388889, 555556, 694444, 777778, 861111, 916667, 944444, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[4] = [uint32(0), 194444, 416667, 555556, 694444, 805556, 888889, 916667, 972222, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
        t[5] = [uint32(0), 222222, 416667, 611111, 722222, 805556, 888889, 916667, 972222, 972222, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000];
    }

}
