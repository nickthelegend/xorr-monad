// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IXorrOracle} from "../src/interfaces/IXorrOracle.sol";
import {TestAUSD} from "../src/TestAUSD.sol";
import {KeeperOracle} from "../src/oracles/KeeperOracle.sol";
import {KuruOracle} from "../src/oracles/KuruOracle.sol";
import {OracleRouter} from "../src/oracles/OracleRouter.sol";
import {ChainlinkOracle} from "../src/oracles/ChainlinkOracle.sol";
import {PythOracle, IPyth} from "../src/oracles/PythOracle.sol";
import {XorrVault} from "../src/XorrVault.sol";
import {RangeMarket} from "../src/RangeMarket.sol";
import {RoomMarket} from "../src/RoomMarket.sol";
import {CalibratedMarkets} from "../src/config/CalibratedMarkets.sol";

/// @notice Deploys the whole desk. Every network-specific address is read from env so
///         nothing stale is ever baked into the source.
///
///   ORACLE_KIND = keeper | chainlink | pyth   (the fallback source)
///   KURU_MON_AUSD = Kuru MON-AUSD order book; when set, MON is priced from the book
///   AUSD        = existing token address, or unset to deploy the 6-decimal test token
///   SEED_VAULT  = AUSD units of starting bankroll (test token only)
contract Deploy is Script {
    bytes32 constant BTC = keccak256("BTC-USD");
    bytes32 constant ETH = keccak256("ETH-USD");
    bytes32 constant MON = keccak256("MON-USD");

    address internal kuruOracle;
    address internal oracleRouter;
    address internal feedOracle;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        string memory kind = vm.envOr("ORACLE_KIND", string("keeper"));

        vm.startBroadcast(pk);

        // ---- asset
        address asset = vm.envOr("AUSD", address(0));
        bool testToken = asset == address(0);
        if (testToken) {
            asset = address(new TestAUSD());
            console2.log("TestAUSD          ", asset);
        }

        // ---- oracle
        IXorrOracle oracle;
        if (_eq(kind, "chainlink")) {
            ChainlinkOracle o = new ChainlinkOracle(deployer);
            _wireFeed(o, BTC, "CHAINLINK_BTC_USD");
            _wireFeed(o, ETH, "CHAINLINK_ETH_USD");
            _wireFeed(o, MON, "CHAINLINK_MON_USD");
            oracle = o;
        } else if (_eq(kind, "pyth")) {
            PythOracle o = new PythOracle(IPyth(vm.envAddress("PYTH")), deployer);
            _wirePyth(o, BTC, "PYTH_BTC_USD");
            _wirePyth(o, ETH, "PYTH_ETH_USD");
            _wirePyth(o, MON, "PYTH_MON_USD");
            oracle = o;
        } else {
            // A real push feed. It carries real market prices submitted by a real
            // keeper in real transactions; what it stands in for is the aggregation
            // network, not the data. Used where the network has no push feed for a
            // pair yet. No seed prices are written here — the feed is empty until the
            // keeper publishes, so a market can never open on an invented number.
            KeeperOracle o = new KeeperOracle(deployer);
            address extra = vm.envOr("KEEPER", address(0));
            if (extra != address(0)) o.setUpdater(extra, true);
            oracle = o;
        }

        // ---- route MON to Kuru's order book, everything else to the feed above
        //
        // MON trades on Monad's own CLOB, so its price should come from the book and
        // nowhere else. BTC and ETH have no Monad-native venue deep enough to settle
        // on, so they keep the published feed. The router lets one market contract
        // serve both without knowing the difference.
        address kuruBook = vm.envOr("KURU_MON_AUSD", address(0));
        if (kuruBook != address(0)) {
            KuruOracle kuru = new KuruOracle(deployer);
            // 5% is wide for a book this liquid; past it the midpoint is not a price
            // anyone would trade at and the market refuses to open or settle on it.
            kuru.setBook(MON, kuruBook, 500, true);
            // And require real size behind that quote: 100 MON resting within 1% of the
            // mid. A tight spread on two dust orders passes every price check and is
            // not a market anyone could settle against.
            kuru.setDepthFloor(MON, 100, 100e10, 8);
            // Mark this book at the microprice. Its two sides rest wildly different
            // size — hundreds of MON bid against tens offered — and a plain midpoint
            // between them is a price neither side would trade at.
            kuru.setMark(MON, KuruOracle.Mark.MICRO);

            /**
             * Settle on a three-second average of that mark, not on the instant.
             *
             * A mark read at the cutoff block is worth attacking for exactly one block:
             * push the book, settle, unwind. Ten blocks of average means holding the
             * book away from its price for the whole window, against everyone else's
             * resting orders and paying the spread both ways — the attack is not
             * blocked, it is priced, which is the only version of this that holds.
             *
             * Three seconds rather than thirty on purpose. A longer window dilutes the
             * attack further but makes the settling price lag the market, and a lag
             * longer than the round is an exploit in the other direction.
             */
            kuru.setTwapWindow(MON, 3);

            OracleRouter router = new OracleRouter(deployer);
            router.setFallback(address(oracle), bytes8("keeper"));
            router.setRoute(MON, address(kuru), bytes8("kuru"));

            console2.log("KuruOracle        ", address(kuru));
            console2.log("  Kuru book       ", kuruBook);
            console2.log("OracleRouter      ", address(router));

            kuruOracle = address(kuru);
            oracleRouter = address(router);
            // Keep a handle on the publishing feed: the keeper authorises and pushes
            // there, not at the router, which only dispatches.
            feedOracle = address(oracle);
            oracle = router;
        }
        console2.log("Oracle            ", address(oracle));

        // ---- core
        XorrVault vault = new XorrVault(IERC20(asset), deployer);
        RangeMarket range = new RangeMarket(IERC20(asset), vault, oracle, deployer);
        RoomMarket room = new RoomMarket(IERC20(asset), vault, oracle, deployer);

        vault.setMarket(address(range), true);
        vault.setMarket(address(room), true);

        // Round lengths and per-round calibration come from src/config/CalibratedMarkets.sol,
        // generated from real market tape by `pnpm --filter @xorr/sdk calibrate`.
        range.setRounds(CalibratedMarkets.roundBlocks());
        _configure(range, 0);
        _configure(range, 1);
        _configure(range, 2);

        // ---- seed bankroll when we own the token
        uint256 seed = vm.envOr("SEED_VAULT", uint256(0));
        if (testToken && seed > 0) {
            TestAUSD(asset).mint(deployer, seed);
            TestAUSD(asset).approve(address(vault), seed);
            vault.deposit(seed);
        }

        vm.stopBroadcast();

        console2.log("XorrVault         ", address(vault));
        console2.log("RangeMarket       ", address(range));
        console2.log("RoomMarket        ", address(room));

        _write(asset, address(oracle), address(vault), address(range), address(room), kind);
    }

    /// @dev MON ships with `enabled = false`: Kuru's MON-AUSD book is read live on the
    ///      desk for the mark and the spread meter, but at ~185 of 24h volume there is
    ///      no honest distribution to fit, so it stays playable on the paper desk and
    ///      unfunded by the vault until the keeper re-marks it from real fills.
    function _configure(RangeMarket range, uint256 i) internal {
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

    function _wireFeed(ChainlinkOracle o, bytes32 id, string memory key) internal {
        address f = vm.envOr(key, address(0));
        if (f != address(0)) o.setFeed(id, f);
    }

    function _wirePyth(PythOracle o, bytes32 id, string memory key) internal {
        bytes32 f = vm.envOr(key, bytes32(0));
        if (f != bytes32(0)) o.setPriceId(id, f, 100); // reject prints wider than 1%
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _write(
        address asset,
        address oracle,
        address vault,
        address range,
        address room,
        string memory kind
    ) internal {
        string memory o = "d";
        vm.serializeUint(o, "chainId", block.chainid);
        // Indexers and the leaderboard scan from here. Scanning earlier is pointless
        // and, on a forked node, pushes the query at the upstream RPC.
        vm.serializeUint(o, "deployBlock", block.number);
        vm.serializeAddress(o, "kuruOracle", kuruOracle);
        // The feed the keeper publishes to. Equals `oracle` when no router is deployed.
        vm.serializeAddress(o, "feedOracle", feedOracle == address(0) ? address(oracle) : feedOracle);
        vm.serializeAddress(o, "oracleRouter", oracleRouter);
        vm.serializeAddress(o, "kuruBook", vm.envOr("KURU_MON_AUSD", address(0)));
        vm.serializeString(o, "oracleKind", kind);
        vm.serializeAddress(o, "ausd", asset);
        vm.serializeAddress(o, "oracle", oracle);
        vm.serializeAddress(o, "vault", vault);
        vm.serializeAddress(o, "rangeMarket", range);
        string memory out = vm.serializeAddress(o, "roomMarket", room);
        vm.writeJson(out, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }
}
