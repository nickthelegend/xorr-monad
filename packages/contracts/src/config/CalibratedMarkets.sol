// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE - do not edit by hand.
/// @dev Produced by `pnpm calibrate` from real market tape.
///      Generated: 2026-09-02T20:27:10.295Z
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
        s[0] = 2223;
        s[1] = 11925;
        s[2] = 22511;
        s[3] = 41192;
        s[4] = 72906;
        s[5] = 134023;
    }

    function minProb1e6_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 326365;
        s[1] = 163257;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 29415;
        s[1] = 58803;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables0() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(306365), 645116, 716736, 773755, 825525, 863860, 896378, 922279, 940380, 954314, 963882, 971465, 977916, 982832, 986333, 988899, 990866];
        t[1] = [uint32(143257), 419837, 568828, 688148, 777663, 840473, 887748, 919020, 942457, 957993, 968428, 977463, 983464, 987531, 990332, 991999, 994066];
        t[2] = [uint32(34547), 288866, 492880, 649393, 752451, 830532, 883987, 922736, 945728, 962418, 973389, 981092, 984944, 989729, 992414, 994281, 995331];
        t[3] = [uint32(2922), 249583, 478715, 651920, 757513, 835977, 889399, 926962, 948664, 961185, 972871, 979549, 984975, 988314, 991653, 994992, 996661];
        t[4] = [uint32(0), 252513, 464824, 621859, 748744, 827889, 889447, 937186, 957286, 977387, 984925, 987437, 991206, 992462, 994975, 996231, 996231];
        t[5] = [uint32(0), 178707, 357414, 555133, 707224, 798479, 870722, 927757, 965779, 980989, 992395, 992395, 992395, 992395, 992395, 992395, 1000000];
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
        s[0] = 3282;
        s[1] = 16634;
        s[2] = 29919;
        s[3] = 54411;
        s[4] = 97397;
        s[5] = 190058;
    }

    function minProb1e6_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 278763;
        s[1] = 125000;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 34438;
        s[1] = 76800;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables1() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(258763), 555828, 654533, 740504, 806424, 857993, 895328, 922729, 942797, 956414, 967215, 975265, 981049, 984883, 987666, 989933, 991716];
        t[1] = [uint32(90215), 353359, 538156, 676846, 775263, 842174, 889948, 919953, 942057, 956759, 968195, 977163, 983397, 987498, 990832, 993066, 994532];
        t[2] = [uint32(16106), 273226, 482493, 642857, 758520, 835784, 886555, 924486, 947829, 965336, 973973, 981793, 987045, 990079, 992880, 994048, 995331];
        t[3] = [uint32(2087), 259182, 484140, 659850, 771285, 850167, 898581, 931553, 956594, 969950, 975793, 981636, 985392, 988731, 992487, 993322, 993740];
        t[4] = [uint32(1256), 261307, 497487, 662060, 778894, 859296, 899497, 924623, 953518, 971106, 981156, 984925, 987437, 991206, 994975, 994975, 994975];
        t[5] = [uint32(3802), 209125, 403042, 574144, 722433, 802281, 893536, 931559, 950570, 958175, 977186, 980989, 992395, 992395, 992395, 1000000, 1000000];
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
        s[0] = 8205;
        s[1] = 41585;
        s[2] = 74798;
        s[3] = 136028;
        s[4] = 243493;
        s[5] = 475145;
    }

    function minProb1e6_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 278763;
        s[1] = 125000;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 34438;
        s[1] = 76800;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables2() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(258763), 555828, 654533, 740504, 806424, 857993, 895328, 922729, 942797, 956414, 967215, 975265, 981049, 984883, 987666, 989933, 991716];
        t[1] = [uint32(90215), 353359, 538156, 676846, 775263, 842174, 889948, 919953, 942057, 956759, 968195, 977163, 983397, 987498, 990832, 993066, 994532];
        t[2] = [uint32(16106), 273226, 482493, 642857, 758520, 835784, 886555, 924486, 947829, 965336, 973973, 981793, 987045, 990079, 992880, 994048, 995331];
        t[3] = [uint32(2087), 259182, 484140, 659850, 771285, 850167, 898581, 931553, 956594, 969950, 975793, 981636, 985392, 988731, 992487, 993322, 993740];
        t[4] = [uint32(1256), 261307, 497487, 662060, 778894, 859296, 899497, 924623, 953518, 971106, 981156, 984925, 987437, 991206, 994975, 994975, 994975];
        t[5] = [uint32(3802), 209125, 403042, 574144, 722433, 802281, 893536, 931559, 950570, 958175, 977186, 980989, 992395, 992395, 992395, 1000000, 1000000];
    }

}
