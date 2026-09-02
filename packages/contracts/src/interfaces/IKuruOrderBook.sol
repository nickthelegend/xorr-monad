// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The parts of Kuru's on-chain order book XORR reads.
/// @dev Kuru is Monad's native CLOB. Both of these are views, so reading them costs a
///      market nothing and cannot be front-run — the book is the book at this block.
interface IKuruOrderBook {
    /// @return bid best bid, 18 decimals
    /// @return ask best ask, 18 decimals
    function bestBidAsk() external view returns (uint256 bid, uint256 ask);

    /// @notice Bounded L2 depth.
    /// @dev Returns `abi`-packed words: the block number, then (price, size) pairs for
    ///      bids descending, a zero word, then (price, size) pairs for asks ascending.
    ///      Prices carry the market's pricePrecision, sizes its sizePrecision.
    function getL2Book(uint32 bidPricePoints, uint32 askPricePoints)
        external
        view
        returns (bytes memory);

    /// @notice The market's own configuration: precisions, tick, size bounds, fees.
    /// @dev Field order matches Kuru's MarketParams struct.
    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAssetAddress,
            uint256 baseAssetDecimals,
            address quoteAssetAddress,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint96 takerFeeBps
        );
}
