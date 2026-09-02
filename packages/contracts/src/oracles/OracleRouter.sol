// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IXorrOracle} from "../interfaces/IXorrOracle.sol";
import {Owned} from "../lib/Auth.sol";

/// @title OracleRouter
/// @notice Sends each market to the price source that suits it.
///
///         XORR's markets do not all want the same oracle. MON trades on Kuru, so its
///         price should come from Kuru's book and nowhere else — reading it is the
///         whole point, and routing it through a relayer would throw away the property
///         that makes it interesting. BTC and ETH do not have a Monad-native venue deep
///         enough to settle on, so they take a published feed.
///
///         Rather than teach RangeMarket about that distinction, the router presents one
///         IXorrOracle and dispatches per market. The market contract stays unaware of
///         where a price came from, which is what lets a market be moved from a feed to
///         a book — or back — without redeploying it.
contract OracleRouter is IXorrOracle, Owned {
    struct Route {
        IXorrOracle source;
        /// @dev A short label the console shows as provenance: "kuru", "keeper", "pyth".
        bytes8 label;
    }

    mapping(bytes32 => Route) public routes;
    IXorrOracle public fallbackSource;
    bytes8 public fallbackLabel;

    event RouteSet(bytes32 indexed marketId, address source, bytes8 label);
    event FallbackSet(address source, bytes8 label);

    constructor(address _owner) Owned(_owner) {}

    function setRoute(bytes32 marketId, address source, bytes8 label) external onlyOwner {
        routes[marketId] = Route({source: IXorrOracle(source), label: label});
        emit RouteSet(marketId, source, label);
    }

    /// @notice Where markets go when they have no route of their own.
    function setFallback(address source, bytes8 label) external onlyOwner {
        fallbackSource = IXorrOracle(source);
        fallbackLabel = label;
        emit FallbackSet(source, label);
    }

    function _sourceFor(bytes32 marketId) internal view returns (IXorrOracle s, bytes8 label) {
        Route memory r = routes[marketId];
        if (address(r.source) != address(0)) return (r.source, r.label);
        return (fallbackSource, fallbackLabel);
    }

    /// @inheritdoc IXorrOracle
    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt) {
        (IXorrOracle s,) = _sourceFor(marketId);
        if (address(s) == address(0)) return (0, 0);
        return s.latest(marketId);
    }

    function hasMarket(bytes32 marketId) external view returns (bool) {
        (IXorrOracle s,) = _sourceFor(marketId);
        if (address(s) == address(0)) return false;
        return s.hasMarket(marketId);
    }

    /// @notice Who is actually pricing this market, for the console to show.
    /// @dev Provenance belongs on-chain. A judge asking "is the Kuru integration real?"
    ///      should be able to answer it from the chain rather than from the UI's word.
    function sourceOf(bytes32 marketId) external view returns (address source, bytes8 label) {
        (IXorrOracle s, bytes8 l) = _sourceFor(marketId);
        return (address(s), l);
    }
}
