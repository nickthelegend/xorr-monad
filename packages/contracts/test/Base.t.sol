// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {TestAUSD} from "../src/TestAUSD.sol";
import {TestOracle} from "./helpers/TestOracle.sol";
import {XorrVault} from "../src/XorrVault.sol";
import {RangeMarket} from "../src/RangeMarket.sol";
import {RoomMarket} from "../src/RoomMarket.sol";
import {Pricing} from "../src/lib/Pricing.sol";

abstract contract Base is Test {
    TestAUSD internal ausd;
    TestOracle internal oracle;
    XorrVault internal vault;
    RangeMarket internal range;
    RoomMarket internal room;

    address internal owner = address(0xA11CE);
    address internal lp = address(0x11B);
    address internal alice = address(0xA);
    address internal bob = address(0xB);
    address internal carol = address(0xC);

    bytes32 internal constant BTC = keccak256("BTC-USD");
    uint256 internal constant SPOT = 100_000e8; // $100,000 at 8dp
    uint32 internal constant VOL_BPS = 12; // 0.12% one-sigma over 100 blocks
    uint32 internal constant REF_BLOCKS = 100;

    // Round tiers, matching src/config/CalibratedMarkets.sol.
    uint8 internal constant T3S = 0; //   10 blocks
    uint8 internal constant T10S = 1; //   33 blocks
    uint8 internal constant T30S = 2; //  100 blocks  <- the tier most tests price against
    uint8 internal constant T100S = 3; //  333 blocks
    uint8 internal constant T300S = 4; // 1000 blocks
    uint8 internal constant T900S = 5; // 3000 blocks

    function setUpBase() internal {
        ausd = new TestAUSD();
        oracle = new TestOracle(owner);
        vault = new XorrVault(IERC20(address(ausd)), owner);
        range = new RangeMarket(IERC20(address(ausd)), vault, oracle, owner);
        room = new RoomMarket(IERC20(address(ausd)), vault, oracle, owner);

        vm.startPrank(owner);
        vault.setMarket(address(range), true);
        vault.setMarket(address(room), true);
        range.setRounds(_rounds());
        range.configureMarket(BTC, _roundConfigs(), _normalTables(), true);
        vm.stopPrank();

        oracle.push(BTC, SPOT);

        // Bankroll and players
        _fund(lp, 1_000_000e6);
        vm.prank(lp);
        vault.deposit(1_000_000e6);

        _fund(alice, 10_000e6);
        _fund(bob, 10_000e6);
        _fund(carol, 10_000e6);
    }

    function _rounds() internal pure returns (uint32[] memory r) {
        r = new uint32[](6);
        r[0] = 10;
        r[1] = 33;
        r[2] = 100;
        r[3] = 333;
        r[4] = 1_000;
        r[5] = 3_000;
    }

    /// @dev Tests price against the textbook normal with sigma scaled by sqrt(time),
    ///      which keeps every hand-derived expectation in this suite checkable by hand.
    ///      Production markets ship a MEASURED distribution per round instead -- see
    ///      src/config/CalibratedMarkets.sol and packages/sdk/src/calibrate-all.ts.
    function _roundConfigs() internal pure returns (RangeMarket.RoundConfig[] memory c) {
        uint32[] memory r = _rounds();
        c = new RangeMarket.RoundConfig[](r.length);
        for (uint256 i = 0; i < r.length; i++) {
            c[i] = RangeMarket.RoundConfig({
                sigma1e4: uint32(Pricing.sigmaBps1e4(VOL_BPS, r[i], REF_BLOCKS)),
                minProb1e6: 125_000,
                maxMultiplierBps: 80_000
            });
        }
    }

    function _normalTables() internal pure returns (uint32[17][] memory t) {
        t = new uint32[17][](_rounds().length);
        for (uint256 i = 0; i < t.length; i++) {
            t[i] = Pricing.normalTable();
        }
    }

    function _fund(address who, uint256 amount) internal {
        ausd.mint(who, amount);
        vm.startPrank(who);
        ausd.approve(address(vault), type(uint256).max);
        ausd.approve(address(range), type(uint256).max);
        ausd.approve(address(room), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Keeps the mock print fresh relative to a warped timestamp.
    function _repush(uint256 price) internal {
        oracle.push(BTC, price);
    }

    /// @dev Roll forward `n` blocks the way Monad would: 300ms per block.
    function _roll(uint256 n) internal {
        vm.roll(block.number + n);
        vm.warp(block.timestamp + ((n * 300) / 1000) + 1);
    }
}
