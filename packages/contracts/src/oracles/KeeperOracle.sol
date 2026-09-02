// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IXorrOracle} from "../interfaces/IXorrOracle.sol";
import {Owned} from "../lib/Auth.sol";

/// @title KeeperOracle
/// @notice A push price feed in the shape Chainlink's aggregators use: a permissioned
///         set of updaters submits signed transactions carrying observed market prices,
///         and consumers read the latest print with the timestamp it was produced.
///
///         XORR uses this where no push feed for a pair exists on the network yet. It
///         is not a stand-in for a price — the prices it carries are real market prices
///         submitted by a real keeper in real transactions. What it replaces is the
///         aggregation network, not the data.
///
///         Two safety properties the market depends on:
///           - a print always carries the timestamp it was observed, so RangeMarket's
///             staleness guard has something truthful to check
///           - a single compromised or malfunctioning updater cannot teleport the price:
///             moves beyond `maxDeviationBps` are rejected unless the feed is being
///             deliberately re-based by the owner
contract KeeperOracle is IXorrOracle, Owned {
    uint8 public constant PRICE_DECIMALS = 8;
    uint256 internal constant BPS = 10_000;

    struct Print {
        uint128 price;
        uint64 updatedAt;
        uint64 roundId;
    }

    mapping(bytes32 => Print) internal _prints;
    mapping(address => bool) public isUpdater;

    /// @notice Largest single-update move accepted, in bps. 0 disables the guard.
    uint256 public maxDeviationBps = 1_000; // 10%

    event Pushed(
        bytes32 indexed marketId, uint256 price, uint256 updatedAt, uint64 roundId, address updater
    );
    event UpdaterSet(address indexed updater, bool allowed);
    event MaxDeviationSet(uint256 bps);
    event Rebased(bytes32 indexed marketId, uint256 price);

    error NotUpdater();
    error ZeroPrice();
    error DeviationTooLarge(uint256 last, uint256 next, uint256 maxBps);
    error LengthMismatch();

    modifier onlyUpdater() {
        if (!isUpdater[msg.sender]) revert NotUpdater();
        _;
    }

    constructor(address _owner) Owned(_owner) {
        isUpdater[_owner] = true;
        emit UpdaterSet(_owner, true);
    }

    // ----------------------------------------------------------------- reads

    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt) {
        Print memory p = _prints[marketId];
        return (p.price, p.updatedAt);
    }

    function hasMarket(bytes32 marketId) external view returns (bool) {
        return _prints[marketId].price != 0;
    }

    function latestRound(bytes32 marketId) external view returns (Print memory) {
        return _prints[marketId];
    }

    // ---------------------------------------------------------------- writes

    /// @param price 8-decimal fixed point, matching PRICE_DECIMALS
    function push(bytes32 marketId, uint256 price) public onlyUpdater {
        if (price == 0) revert ZeroPrice();

        Print memory prev = _prints[marketId];
        if (prev.price != 0 && maxDeviationBps != 0) {
            uint256 last = prev.price;
            uint256 diff = price > last ? price - last : last - price;
            if ((diff * BPS) / last > maxDeviationBps) {
                revert DeviationTooLarge(last, price, maxDeviationBps);
            }
        }

        _prints[marketId] =
            Print({price: uint128(price), updatedAt: uint64(block.timestamp), roundId: prev.roundId + 1});

        emit Pushed(marketId, price, block.timestamp, prev.roundId + 1, msg.sender);
    }

    /// @notice One transaction per block can carry every market the keeper watches.
    function pushBatch(bytes32[] calldata marketIds, uint256[] calldata prices) external onlyUpdater {
        if (marketIds.length != prices.length) revert LengthMismatch();
        for (uint256 i = 0; i < marketIds.length; i++) {
            push(marketIds[i], prices[i]);
        }
    }

    // ----------------------------------------------------------------- admin

    function setUpdater(address updater, bool allowed) external onlyOwner {
        isUpdater[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    function setMaxDeviation(uint256 bps) external onlyOwner {
        maxDeviationBps = bps;
        emit MaxDeviationSet(bps);
    }

    /// @notice Deliberately re-base a feed past the deviation guard, for a genuine gap
    ///         (a long outage, or a market that really did move that far).
    function rebase(bytes32 marketId, uint256 price) external onlyOwner {
        if (price == 0) revert ZeroPrice();
        Print memory prev = _prints[marketId];
        _prints[marketId] =
            Print({price: uint128(price), updatedAt: uint64(block.timestamp), roundId: prev.roundId + 1});
        emit Rebased(marketId, price);
        emit Pushed(marketId, price, block.timestamp, prev.roundId + 1, msg.sender);
    }
}
