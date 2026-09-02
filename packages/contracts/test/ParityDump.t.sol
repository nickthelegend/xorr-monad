// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pricing} from "../src/lib/Pricing.sol";

/// @notice Dumps a grid of quotes straight out of the pricing library. The TypeScript
///         mirror in packages/sdk re-derives every row and asserts an exact match, so
///         "the multiplier preview matches contract math" is a checked fact rather
///         than a claim. Run via `pnpm test:parity`.
contract ParityDump is Test {
    string constant OUT = "./parity/quotes.csv";

    function test_DumpQuoteGrid() public {
        vm.writeFile(OUT, "spot,low,high,blocks,volBps,refBlocks,houseEdgeBps,multiplierBps,prob1e6\n");

        uint256[2] memory spots = [uint256(100_000e8), uint256(2e8)];
        uint256[3] memory vols = [uint256(12), uint256(16), uint256(40)];
        uint256[8] memory horizons = [uint256(10), 25, 50, 100, 250, 600, 2_000, 6_000];
        uint256[6] memory edges = [uint256(1), 3, 8, 21, 55, 144];

        uint256 rows;
        for (uint256 a = 0; a < spots.length; a++) {
            for (uint256 b = 0; b < vols.length; b++) {
                for (uint256 c = 0; c < horizons.length; c++) {
                    rows += _dumpEdgeGrid(spots[a], vols[b], horizons[c], edges);
                }
            }
        }
        assertGt(rows, 1_000, "grid must be broad enough to be evidence");
    }

    /// @dev Inner two loops live here so the outer ones keep the stack under 16 slots.
    function _dumpEdgeGrid(uint256 spot, uint256 vol, uint256 blocks_, uint256[6] memory edges)
        internal
        returns (uint256 rows)
    {
        for (uint256 d = 0; d < edges.length; d++) {
            for (uint256 e = 0; e < edges.length; e++) {
                uint256 low = spot - (spot * edges[d]) / 10_000;
                uint256 high = spot + (spot * edges[e]) / 10_000;
                if (low == 0 || low >= spot || high <= spot) continue;

                (uint256 mult, uint256 prob) = Pricing.quote(
                    Pricing.normalTable(), spot, low, high, Pricing.sigmaBps1e4(vol, blocks_, 100), 400
                );
                _emit(spot, low, high, blocks_, vol, mult, prob);
                rows++;
            }
        }
    }

    /// @dev Row building gets its own frame: nine toString calls concatenated inline
    ///      blow the 16-slot stack limit inside the loop.
    function _emit(
        uint256 spot,
        uint256 low,
        uint256 high,
        uint256 blocks_,
        uint256 vol,
        uint256 mult,
        uint256 prob
    ) internal {
        string memory head =
            string.concat(vm.toString(spot), ",", vm.toString(low), ",", vm.toString(high));
        string memory mid = string.concat(vm.toString(blocks_), ",", vm.toString(vol), ",100,400");
        string memory tail = string.concat(vm.toString(mult), ",", vm.toString(prob));
        vm.writeLine(OUT, string.concat(head, ",", mid, ",", tail));
    }
}
