// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Every price XORR settles against is normalised to 8 decimals by the adapter.
interface IXorrOracle {
    /// @param marketId keccak256 of the pair label, e.g. keccak256("BTC-USD")
    /// @return price     price in PRICE_DECIMALS (8) fixed point
    /// @return updatedAt unix seconds the print was produced
    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt);

    /// @notice True when the adapter can serve this market at all.
    function hasMarket(bytes32 marketId) external view returns (bool);
}
