// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IXorrOracle} from "../interfaces/IXorrOracle.sol";
import {IKuruOrderBook} from "../interfaces/IKuruOrderBook.sol";
import {Owned} from "../lib/Auth.sol";

/// @title KuruOracle
/// @notice Prices a XORR market from Kuru's on-chain order book.
///
///         Every other oracle in this repo is a report of what happened somewhere else:
///         a keeper relaying an exchange, or an aggregation network signing a number.
///         This one reads the book directly. The mid it returns is the midpoint of real
///         resting orders on Monad's native CLOB at the current block — there is no
///         off-chain component, no relayer, and nothing to trust between the venue and
///         the settlement.
///
///         That makes the freshness question different too. A push feed can go stale
///         because the publisher stopped; an order book cannot, because reading it *is*
///         the observation. What it can do instead is go thin — one side empty, or a
///         spread so wide the midpoint is a number nobody would trade at. Those are the
///         conditions guarded here, and when they hold the oracle reports no price at
///         all rather than a plausible-looking one.
contract KuruOracle is IXorrOracle, Owned {
    uint8 public constant PRICE_DECIMALS = 8;
    /// @dev Kuru quotes bestBidAsk with 18 decimals; XORR settles on 8.
    uint256 internal constant SCALE_DOWN = 1e10;
    uint256 internal constant BPS = 10_000;

    struct Book {
        IKuruOrderBook market;
        /// @dev Widest bid/ask spread, in bps of the mid, that still yields a price.
        uint32 maxSpreadBps;
        bool enabled;
    }

    mapping(bytes32 => Book) public books;

    event BookSet(bytes32 indexed marketId, address market, uint32 maxSpreadBps, bool enabled);

    error NoBook();
    error BadSpread();

    constructor(address _owner) Owned(_owner) {}

    /// @param maxSpreadBps 0 disables the spread guard.
    function setBook(bytes32 marketId, address market, uint32 maxSpreadBps, bool enabled)
        external
        onlyOwner
    {
        books[marketId] = Book({
            market: IKuruOrderBook(market),
            maxSpreadBps: maxSpreadBps,
            enabled: enabled
        });
        emit BookSet(marketId, market, maxSpreadBps, enabled);
    }

    // ----------------------------------------------------------------- reads

    /// @inheritdoc IXorrOracle
    /// @dev `updatedAt` is this block's timestamp, and that is the honest answer: the
    ///      book was read now. A stale reading of an order book is not a thing that can
    ///      happen — if the venue is quiet the orders are simply still there.
    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt) {
        Book memory b = books[marketId];
        if (!b.enabled || address(b.market) == address(0)) return (0, 0);

        (uint256 bid, uint256 ask) = b.market.bestBidAsk();

        // A one-sided book has no midpoint. Say so instead of inventing one.
        if (bid == 0 || ask == 0) return (0, 0);
        if (ask < bid) return (0, 0); // crossed; the venue is mid-update

        uint256 mid = (bid + ask) / 2;
        if (mid == 0) return (0, 0);

        if (b.maxSpreadBps != 0) {
            uint256 spreadBps = ((ask - bid) * BPS) / mid;
            // A book this thin is not a price anyone could trade at, and settling a
            // market on its midpoint would be settling on a number nobody quoted.
            if (spreadBps > b.maxSpreadBps) return (0, 0);
        }

        price = mid / SCALE_DOWN;
        if (price == 0) return (0, 0); // below 8-decimal resolution
        updatedAt = block.timestamp;
    }

    function hasMarket(bytes32 marketId) external view returns (bool) {
        Book memory b = books[marketId];
        if (!b.enabled || address(b.market) == address(0)) return false;
        (uint256 bid, uint256 ask) = b.market.bestBidAsk();
        return bid != 0 && ask != 0 && ask >= bid;
    }

    /// @notice Best bid and ask as XORR sees them, in 8 decimals, plus the spread.
    /// @dev For the console's order-book panel: one call instead of decoding bytes in
    ///      the browser.
    function quoteTop(bytes32 marketId)
        external
        view
        returns (uint256 bid8, uint256 ask8, uint256 mid8, uint256 spreadBps)
    {
        Book memory b = books[marketId];
        if (address(b.market) == address(0)) revert NoBook();
        (uint256 bid, uint256 ask) = b.market.bestBidAsk();
        if (bid == 0 || ask == 0) return (0, 0, 0, 0);
        uint256 mid = (bid + ask) / 2;
        return (
            bid / SCALE_DOWN,
            ask / SCALE_DOWN,
            mid / SCALE_DOWN,
            mid == 0 ? 0 : ((ask > bid ? ask - bid : 0) * BPS) / mid
        );
    }

    /**
     * @notice Decoded L2 depth, so the console does not have to unpack bytes.
     * @dev Kuru packs the book as: block number, then (price, size) pairs for bids
     *      descending, a zero word, then (price, size) pairs for asks ascending.
     *      Prices and sizes carry the market's own precision and are returned as read —
     *      converting them here would bake in an assumption about a market this
     *      contract does not own.
     */
    function depth(bytes32 marketId, uint32 levels)
        external
        view
        returns (
            uint256 blockNumber,
            uint256[] memory bidPrices,
            uint256[] memory bidSizes,
            uint256[] memory askPrices,
            uint256[] memory askSizes
        )
    {
        Book memory b = books[marketId];
        if (address(b.market) == address(0)) revert NoBook();

        bytes memory raw = b.market.getL2Book(levels, levels);
        uint256 words = raw.length / 32;
        if (words == 0) return (0, bidPrices, bidSizes, askPrices, askSizes);

        bidPrices = new uint256[](levels);
        bidSizes = new uint256[](levels);
        askPrices = new uint256[](levels);
        askSizes = new uint256[](levels);

        blockNumber = _word(raw, 0);

        uint256 i = 1;
        uint256 n;
        // Bids run until the zero word that separates the sides.
        while (i + 1 < words && n < levels) {
            uint256 p = _word(raw, i);
            if (p == 0) break;
            bidPrices[n] = p;
            bidSizes[n] = _word(raw, i + 1);
            n++;
            i += 2;
        }

        // Skip the separator, then read the asks.
        while (i < words && _word(raw, i) == 0) i++;
        n = 0;
        while (i + 1 < words && n < levels) {
            uint256 p = _word(raw, i);
            if (p == 0) break;
            askPrices[n] = p;
            askSizes[n] = _word(raw, i + 1);
            n++;
            i += 2;
        }
    }

    function _word(bytes memory raw, uint256 index) internal pure returns (uint256 v) {
        uint256 offset = 32 + index * 32;
        assembly {
            v := mload(add(raw, offset))
        }
    }
}
