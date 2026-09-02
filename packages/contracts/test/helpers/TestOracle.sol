// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IXorrOracle} from "../../src/interfaces/IXorrOracle.sol";
import {Owned} from "../../src/lib/Auth.sol";

/// @notice Test double. Lets unit tests drive price and staleness directly, which is
///         the only way to exercise the stale-print and dead-feed paths. It lives under
///         test/ and is never referenced by src/ or by any deployment script.
contract TestOracle is IXorrOracle, Owned {
    struct Print {
        uint256 price;
        uint256 updatedAt;
        bool live;
    }

    mapping(bytes32 => Print) public prints;

    event Pushed(bytes32 indexed marketId, uint256 price, uint256 updatedAt);

    constructor(address _owner) Owned(_owner) {}

    function push(bytes32 marketId, uint256 price) external {
        prints[marketId] = Print(price, block.timestamp, true);
        emit Pushed(marketId, price, block.timestamp);
    }

    /// @dev Lets tests age a print without warping the whole chain.
    function pushAt(bytes32 marketId, uint256 price, uint256 updatedAt) external {
        prints[marketId] = Print(price, updatedAt, true);
        emit Pushed(marketId, price, updatedAt);
    }

    function latest(bytes32 marketId) external view returns (uint256, uint256) {
        Print memory p = prints[marketId];
        return (p.price, p.updatedAt);
    }

    function hasMarket(bytes32 marketId) external view returns (bool) {
        return prints[marketId].live;
    }
}
