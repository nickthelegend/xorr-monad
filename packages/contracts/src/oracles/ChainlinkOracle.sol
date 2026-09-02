// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IXorrOracle} from "../interfaces/IXorrOracle.sol";
import {Owned} from "../lib/Auth.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Chainlink push feeds, normalised to 8 decimals.
/// @dev Feed addresses are set per market rather than hardcoded: Chainlink publishes
///      Monad feeds on its own schedule, so the deployer wires them from the live
///      address page at deploy time instead of the source baking in a stale constant.
contract ChainlinkOracle is IXorrOracle, Owned {
    uint8 public constant TARGET_DECIMALS = 8;

    mapping(bytes32 => AggregatorV3Interface) public feeds;

    event FeedSet(bytes32 indexed marketId, address feed);

    error NoFeed();

    constructor(address _owner) Owned(_owner) {}

    function setFeed(bytes32 marketId, address feed) external onlyOwner {
        feeds[marketId] = AggregatorV3Interface(feed);
        emit FeedSet(marketId, feed);
    }

    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt) {
        AggregatorV3Interface feed = feeds[marketId];
        if (address(feed) == address(0)) revert NoFeed();

        (uint80 roundId, int256 answer,, uint256 _updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0 || _updatedAt == 0 || answeredInRound < roundId) return (0, 0);

        uint8 d = feed.decimals();
        uint256 raw = uint256(answer);
        price = d == TARGET_DECIMALS
            ? raw
            : (d < TARGET_DECIMALS ? raw * (10 ** (TARGET_DECIMALS - d)) : raw / (10 ** (d - TARGET_DECIMALS)));
        updatedAt = _updatedAt;
    }

    function hasMarket(bytes32 marketId) external view returns (bool) {
        return address(feeds[marketId]) != address(0);
    }
}
