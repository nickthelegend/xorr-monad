// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleRouter} from "../src/oracles/OracleRouter.sol";
import {IXorrOracle} from "../src/interfaces/IXorrOracle.sol";

contract SourceDouble is IXorrOracle {
    uint256 public price;
    uint256 public at;

    function set(uint256 p, uint256 t) external {
        price = p;
        at = t;
    }

    function latest(bytes32) external view returns (uint256, uint256) {
        return (price, at);
    }

    function hasMarket(bytes32) external view returns (bool) {
        return price != 0;
    }
}

contract OracleRouterTest is Test {
    OracleRouter internal router;
    SourceDouble internal kuru;
    SourceDouble internal keeper;
    address internal owner = address(0xA11CE);

    bytes32 internal constant MON = keccak256("MON-USD");
    bytes32 internal constant BTC = keccak256("BTC-USD");

    function setUp() public {
        router = new OracleRouter(owner);
        kuru = new SourceDouble();
        keeper = new SourceDouble();
        kuru.set(2_569_700, 111);
        keeper.set(7_700_000_000_000, 222);

        vm.startPrank(owner);
        router.setFallback(address(keeper), bytes8("keeper"));
        router.setRoute(MON, address(kuru), bytes8("kuru"));
        vm.stopPrank();
    }

    /// @notice MON reads the book; BTC reads the feed. Same market contract, one call.
    function test_EachMarketReachesItsOwnSource() public view {
        (uint256 monPrice,) = router.latest(MON);
        (uint256 btcPrice,) = router.latest(BTC);
        assertEq(monPrice, 2_569_700);
        assertEq(btcPrice, 7_700_000_000_000);
    }

    function test_UnroutedMarketsTakeTheFallback() public view {
        (address src, bytes8 label) = router.sourceOf(BTC);
        assertEq(src, address(keeper));
        assertEq(label, bytes8("keeper"));
    }

    /// @notice Provenance is answerable from the chain, not from the interface's word.
    function test_ProvenanceIsOnChain() public view {
        (address src, bytes8 label) = router.sourceOf(MON);
        assertEq(src, address(kuru));
        assertEq(label, bytes8("kuru"));
    }

    /// @notice A market can be moved between a book and a feed without redeploying it.
    function test_ARouteCanBeRepointed() public {
        vm.prank(owner);
        router.setRoute(MON, address(keeper), bytes8("keeper"));
        (uint256 p,) = router.latest(MON);
        assertEq(p, 7_700_000_000_000);
    }

    /// @notice A silent zero is the correct answer for an unknown market — the market
    ///         contract's own staleness check then refuses to open or settle.
    function test_NoSourceMeansNoPrice() public {
        OracleRouter bare = new OracleRouter(owner);
        (uint256 p, uint256 t) = bare.latest(MON);
        assertEq(p, 0);
        assertEq(t, 0);
        assertFalse(bare.hasMarket(MON));
    }

    function test_OnlyOwnerRoutes() public {
        vm.expectRevert();
        router.setRoute(MON, address(keeper), bytes8("keeper"));
        vm.expectRevert();
        router.setFallback(address(keeper), bytes8("keeper"));
    }

    /// @notice A source that goes quiet propagates its silence rather than a stale price.
    function test_SilencePropagates() public {
        kuru.set(0, 0);
        (uint256 p,) = router.latest(MON);
        assertEq(p, 0);
        assertFalse(router.hasMarket(MON));
    }
}
