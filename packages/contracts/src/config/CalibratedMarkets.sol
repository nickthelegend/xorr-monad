// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE - do not edit by hand.
/// @dev Produced by `pnpm calibrate` from real market tape.
///      Generated: 2026-09-02T16:17:16.452Z
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
        s[0] = 6717;
        s[1] = 13533;
        s[2] = 23662;
        s[3] = 44377;
        s[4] = 75264;
        s[5] = 145622;
    }

    function minProb1e6_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 329982;
        s[1] = 162290;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_0() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 29092;
        s[1] = 59153;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables0() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(309982), 635065, 709285, 769255, 821208, 861610, 896095, 921313, 940297, 954198, 964465, 972032, 978482, 982899, 986316, 988833, 990550];
        t[1] = [uint32(142290), 407901, 558760, 683547, 774429, 839307, 887215, 920320, 943624, 958760, 968528, 977330, 983397, 987265, 990298, 992232, 993866];
        t[2] = [uint32(33147), 281979, 490546, 641690, 753852, 832049, 883170, 918301, 946195, 962185, 973389, 980509, 985994, 989729, 992880, 994865, 996148];
        t[3] = [uint32(1252), 235392, 463689, 643155, 756260, 839316, 892738, 928214, 949499, 962437, 973289, 979549, 984975, 989149, 991235, 992905, 996661];
        t[4] = [uint32(1256), 243719, 464824, 623116, 737437, 816583, 890704, 935930, 958543, 979899, 984925, 987437, 991206, 991206, 992462, 996231, 996231];
        t[5] = [uint32(0), 193916, 384030, 558935, 684411, 775665, 878327, 927757, 946768, 980989, 988593, 988593, 992395, 996198, 1000000, 1000000, 1000000];
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
        s[0] = 9437;
        s[1] = 18541;
        s[2] = 31217;
        s[3] = 55272;
        s[4] = 97200;
        s[5] = 170904;
    }

    function minProb1e6_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 277896;
        s[1] = 125000;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_1() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 34545;
        s[1] = 76800;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables1() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(257896), 550828, 658116, 741104, 807590, 858760, 896912, 924180, 943564, 957431, 967915, 975465, 980699, 984783, 987733, 989833, 991816];
        t[1] = [uint32(89615), 361127, 541024, 680880, 778563, 845008, 892115, 920553, 941590, 956793, 968061, 976863, 983431, 987565, 990732, 992832, 994432];
        t[2] = [uint32(19024), 271008, 482493, 648693, 762722, 841153, 891223, 924603, 947246, 962535, 974556, 981559, 985994, 989146, 991363, 994048, 995215];
        t[3] = [uint32(1669), 266694, 495409, 666110, 784224, 857679, 901503, 933222, 953673, 964524, 972454, 976628, 984140, 987479, 991653, 992487, 994157];
        t[4] = [uint32(1256), 275126, 508794, 675879, 782663, 859296, 899497, 929648, 956030, 974874, 982412, 986181, 989950, 991206, 992462, 992462, 992462];
        t[5] = [uint32(0), 224335, 410646, 608365, 745247, 847909, 885932, 920152, 935361, 958175, 961977, 977186, 984791, 988593, 1000000, 1000000, 1000000];
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
        s[0] = 23593;
        s[1] = 46353;
        s[2] = 78043;
        s[3] = 138180;
        s[4] = 243000;
        s[5] = 427260;
    }

    function minProb1e6_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 277896;
        s[1] = 125000;
        s[2] = 125000;
        s[3] = 125000;
        s[4] = 125000;
        s[5] = 125000;
    }

    function maxMultBps_2() internal pure returns (uint32[] memory s) {
        s = new uint32[](6);
        s[0] = 34545;
        s[1] = 76800;
        s[2] = 76800;
        s[3] = 76800;
        s[4] = 76800;
        s[5] = 76800;
    }

    function tables2() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](6);
        t[0] = [uint32(257896), 550828, 658116, 741104, 807590, 858760, 896912, 924180, 943564, 957431, 967915, 975465, 980699, 984783, 987733, 989833, 991816];
        t[1] = [uint32(89615), 361127, 541024, 680880, 778563, 845008, 892115, 920553, 941590, 956793, 968061, 976863, 983431, 987565, 990732, 992832, 994432];
        t[2] = [uint32(19024), 271008, 482493, 648693, 762722, 841153, 891223, 924603, 947246, 962535, 974556, 981559, 985994, 989146, 991363, 994048, 995215];
        t[3] = [uint32(1669), 266694, 495409, 666110, 784224, 857679, 901503, 933222, 953673, 964524, 972454, 976628, 984140, 987479, 991653, 992487, 994157];
        t[4] = [uint32(1256), 275126, 508794, 675879, 782663, 859296, 899497, 929648, 956030, 974874, 982412, 986181, 989950, 991206, 992462, 992462, 992462];
        t[5] = [uint32(0), 224335, 410646, 608365, 745247, 847909, 885932, 920152, 935361, 958175, 961977, 977186, 984791, 988593, 1000000, 1000000, 1000000];
    }

}
