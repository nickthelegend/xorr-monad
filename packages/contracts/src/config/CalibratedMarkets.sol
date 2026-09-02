// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE - do not edit by hand.
/// @dev Produced by `pnpm calibrate` from real market tape.
///      Generated: 2026-09-02T19:47:47.858Z
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
        s[0] = 5178;
        s[1] = 11800;
        s[2] = 22268;
        s[3] = 40701;
        s[4] = 74995;
        s[5] = 146912;
    }

    function minProb1e6_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 328149;
        s[1] = 163457;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 29255;
        s[1] = 58731;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables0() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(308149), 643466, 715786, 772339, 824441, 863510, 896862, 922646, 940697, 954614, 964015, 971582, 977916, 982549, 986283, 989016, 991016];
        t[1] = [uint32(143457), 417770, 567261, 688681, 778096, 840607, 887915, 919353, 942690, 957760, 968695, 977796, 983697, 987331, 990098, 991965, 993866];
        t[2] = [uint32(35131), 286765, 495915, 640406, 751984, 832516, 883754, 920168, 945145, 961601, 974790, 981559, 985644, 988912, 991597, 994514, 995682];
        t[3] = [uint32(2087), 259182, 489566, 641068, 760851, 836394, 884808, 924457, 943656, 959516, 970785, 978297, 985810, 988731, 992905, 995826, 997078];
        t[4] = [uint32(1256), 232412, 453518, 629397, 738693, 835427, 886935, 938442, 962312, 971106, 981156, 987437, 989950, 993719, 993719, 994975, 994975];
        t[5] = [uint32(0), 212928, 403042, 528517, 684411, 802281, 870722, 920152, 946768, 973384, 984791, 996198, 996198, 1000000, 1000000, 1000000, 1000000];
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
        s[0] = 7586;
        s[1] = 16706;
        s[2] = 29640;
        s[3] = 53548;
        s[4] = 98203;
        s[5] = 187318;
    }

    function minProb1e6_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 277046;
        s[1] = 125000;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 34651;
        s[1] = 76800;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables1() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(257046), 554411, 657900, 739287, 808574, 858643, 896095, 923129, 943030, 956531, 967398, 975249, 980799, 984483, 987449, 989749, 991633];
        t[1] = [uint32(89615), 355326, 537156, 678346, 776329, 842640, 890182, 919620, 941390, 956759, 968261, 977163, 983231, 987498, 990698, 992865, 994399];
        t[2] = [uint32(15873), 279412, 492880, 648226, 761788, 840686, 888772, 924953, 947829, 966153, 976190, 982493, 986461, 989146, 991947, 993581, 995448];
        t[3] = [uint32(1252), 260017, 478297, 661102, 778798, 848080, 894407, 934474, 951169, 964107, 972454, 980384, 984558, 989149, 991653, 992487, 994157];
        t[4] = [uint32(3769), 282663, 482412, 655779, 771357, 860553, 905779, 943467, 964824, 969849, 981156, 986181, 988693, 991206, 991206, 992462, 994975];
        t[5] = [uint32(0), 212928, 414449, 604563, 741445, 828897, 897338, 935361, 950570, 969582, 969582, 980989, 980989, 984791, 992395, 996198, 1000000];
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
        s[0] = 18965;
        s[1] = 41765;
        s[2] = 74100;
        s[3] = 133870;
        s[4] = 245508;
        s[5] = 468295;
    }

    function minProb1e6_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 277046;
        s[1] = 125000;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 34651;
        s[1] = 76800;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables2() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(257046), 554411, 657900, 739287, 808574, 858643, 896095, 923129, 943030, 956531, 967398, 975249, 980799, 984483, 987449, 989749, 991633];
        t[1] = [uint32(89615), 355326, 537156, 678346, 776329, 842640, 890182, 919620, 941390, 956759, 968261, 977163, 983231, 987498, 990698, 992865, 994399];
        t[2] = [uint32(15873), 279412, 492880, 648226, 761788, 840686, 888772, 924953, 947829, 966153, 976190, 982493, 986461, 989146, 991947, 993581, 995448];
        t[3] = [uint32(1252), 260017, 478297, 661102, 778798, 848080, 894407, 934474, 951169, 964107, 972454, 980384, 984558, 989149, 991653, 992487, 994157];
        t[4] = [uint32(3769), 282663, 482412, 655779, 771357, 860553, 905779, 943467, 964824, 969849, 981156, 986181, 988693, 991206, 991206, 992462, 994975];
        t[5] = [uint32(0), 212928, 414449, 604563, 741445, 828897, 897338, 935361, 950570, 969582, 969582, 980989, 980989, 984791, 992395, 996198, 1000000];
    }

}
