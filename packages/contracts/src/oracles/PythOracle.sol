// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IXorrOracle} from "../interfaces/IXorrOracle.sol";
import {Owned} from "../lib/Auth.sol";

interface IPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory);
}

/// @notice Pyth pull oracle, normalised to 8 decimals.
/// @dev The Monad docs list a testnet Pyth deployment carrying MON/USD, which is what
///      makes a real MON settlement path possible before mainnet. Staleness is judged
///      by RangeMarket, so this adapter reads unsafe and reports publishTime honestly
///      rather than reverting inside a view the desk calls on every frame.
contract PythOracle is IXorrOracle, Owned {
    uint8 public constant TARGET_DECIMALS = 8;

    IPyth public immutable pyth;
    mapping(bytes32 => bytes32) public priceIds; // marketId => pyth feed id
    mapping(bytes32 => uint256) public maxConfBps; // reject prints wider than this

    event PriceIdSet(bytes32 indexed marketId, bytes32 priceId, uint256 maxConfBps);

    error NoPriceId();

    constructor(IPyth _pyth, address _owner) Owned(_owner) {
        pyth = _pyth;
    }

    function setPriceId(bytes32 marketId, bytes32 priceId, uint256 _maxConfBps) external onlyOwner {
        priceIds[marketId] = priceId;
        maxConfBps[marketId] = _maxConfBps;
        emit PriceIdSet(marketId, priceId, _maxConfBps);
    }

    function latest(bytes32 marketId) external view returns (uint256 price, uint256 updatedAt) {
        bytes32 id = priceIds[marketId];
        if (id == bytes32(0)) revert NoPriceId();

        IPyth.Price memory p = pyth.getPriceUnsafe(id);
        if (p.price <= 0) return (0, 0);

        uint256 raw = uint256(uint64(p.price));

        // A print whose confidence interval is wide is a print we do not settle on.
        uint256 confCap = maxConfBps[marketId];
        if (confCap != 0 && (uint256(p.conf) * 10_000) / raw > confCap) return (0, 0);

        // expo is negative in practice: price = raw * 10^expo
        int32 expo = p.expo;
        int256 shift = int256(uint256(TARGET_DECIMALS)) + int256(expo);
        price = shift >= 0 ? raw * (10 ** uint256(shift)) : raw / (10 ** uint256(-shift));
        updatedAt = p.publishTime;
    }

    function hasMarket(bytes32 marketId) external view returns (bool) {
        return priceIds[marketId] != bytes32(0);
    }
}
