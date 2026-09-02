// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {RangeMarket} from "../src/RangeMarket.sol";
import {CalibratedMarkets} from "../src/config/CalibratedMarkets.sol";

/// @notice Push a fresh calibration onto a live market without redeploying.
///
///         This is the operation that keeps the spread honest. Volatility moves faster
///         than any fixed calibration, so the pricing is deliberately fitted to the
///         quieter end of recent behaviour; re-marking often is what narrows the
///         resulting edge back toward the fee. Run `pnpm calibrate` first.
contract Remark is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        string memory json =
            vm.readFile(string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        RangeMarket range = RangeMarket(vm.parseJsonAddress(json, ".rangeMarket"));

        vm.startBroadcast(pk);
        range.setRounds(CalibratedMarkets.roundBlocks());
        _apply(range, 0);
        _apply(range, 1);
        _apply(range, 2);
        vm.stopBroadcast();

        console2.log("re-marked", range.roundCount(), "rounds across 3 markets");
    }

    function _apply(RangeMarket range, uint256 i) internal {
        bytes32 id;
        bool on;
        uint32[] memory sigma;
        uint32[] memory minProb;
        uint32[] memory maxMult;
        uint32[17][] memory tables;

        if (i == 0) {
            (id, on) = (CalibratedMarkets.marketId0(), CalibratedMarkets.enabled0());
            (sigma, minProb) = (CalibratedMarkets.sigma1e4_0(), CalibratedMarkets.minProb1e6_0());
            (maxMult, tables) = (CalibratedMarkets.maxMultBps_0(), CalibratedMarkets.tables0());
        } else if (i == 1) {
            (id, on) = (CalibratedMarkets.marketId1(), CalibratedMarkets.enabled1());
            (sigma, minProb) = (CalibratedMarkets.sigma1e4_1(), CalibratedMarkets.minProb1e6_1());
            (maxMult, tables) = (CalibratedMarkets.maxMultBps_1(), CalibratedMarkets.tables1());
        } else {
            (id, on) = (CalibratedMarkets.marketId2(), CalibratedMarkets.enabled2());
            (sigma, minProb) = (CalibratedMarkets.sigma1e4_2(), CalibratedMarkets.minProb1e6_2());
            (maxMult, tables) = (CalibratedMarkets.maxMultBps_2(), CalibratedMarkets.tables2());
        }

        RangeMarket.RoundConfig[] memory cfgs = new RangeMarket.RoundConfig[](sigma.length);
        for (uint256 k = 0; k < sigma.length; k++) {
            cfgs[k] = RangeMarket.RoundConfig({
                sigma1e4: sigma[k],
                minProb1e6: minProb[k],
                maxMultiplierBps: maxMult[k]
            });
        }
        range.configureMarket(id, cfgs, tables, on);
    }
}
