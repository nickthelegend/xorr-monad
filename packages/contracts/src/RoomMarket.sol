// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IXorrOracle} from "./interfaces/IXorrOracle.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {Owned, Pausable, ReentrancyGuard} from "./lib/Auth.sol";
import {XorrVault} from "./XorrVault.sol";

/// @title RoomMarket
/// @notice A shared cutoff and a shared pot. Everyone in the room settles on the same
///         print at the same block, and everyone paints their own band.
///
///         The spec's split rules ("all inside → split, one inside → that side takes,
///         all outside → refund minus dust") only carry information if bands differ per
///         player. One band for the whole room makes every outcome unanimous and there
///         is nothing to split, so a room here is: shared market, shared cutoff, shared
///         pot, individual bands.
///
///         Rooms are peer-to-peer. The vault takes a fee and carries no exposure, so a
///         room can never move the house bankroll against the LPs.
contract RoomMarket is Owned, Pausable, ReentrancyGuard {
    using SafeTransfer for IERC20;

    uint8 public constant STATUS_OPEN = 0;
    uint8 public constant STATUS_SETTLED = 1;
    uint8 public constant STATUS_VOID = 2;
    uint256 internal constant BPS = 10_000;

    struct Room {
        bytes32 marketId;
        address creator;
        uint48 openBlock;
        uint48 expiryBlock;
        uint128 stake;
        uint128 settledPrice;
        uint8 maxPlayers;
        uint8 status;
        bytes8 code;
    }

    struct Entry {
        address player;
        uint128 low;
        uint128 high;
        bool won;
    }

    IERC20 public immutable asset;
    XorrVault public immutable vault;
    IXorrOracle public oracle;

    mapping(uint64 => Room) public rooms;
    mapping(uint64 => Entry[]) internal _entries;
    mapping(bytes8 => uint64) public roomByCode;
    mapping(uint64 => mapping(address => bool)) public joined;
    uint64 public nextRoomId = 1;

    uint8 public constant MAX_PLAYERS_CEILING = 20;
    uint256 public roomFeeBps = 300; // 3% of a settled pot
    uint256 public dustFeeBps = 100; // 1% when nobody lands inside
    uint256 public maxStaleness = 30;
    uint32 public settleWindowBlocks = 2_000;
    uint32 public minBlocks = 10;
    uint32 public maxBlocks = 6_000;

    event RoomCreated(
        uint64 indexed id, bytes8 indexed code, address indexed creator, bytes32 marketId,
        uint128 stake, uint48 expiryBlock, uint8 maxPlayers
    );
    event RoomJoined(uint64 indexed id, address indexed player, uint128 low, uint128 high, uint8 seat);
    event RoomSettled(uint64 indexed id, uint128 settledPrice, uint8 winners, uint256 potPaid, uint256 fee);
    event RoomVoided(uint64 indexed id);
    event OracleSet(address indexed oracle);

    error CodeTaken();
    error UnknownRoom();
    error RoomFull();
    error AlreadyJoined();
    error BadBand();
    error BadHorizon();
    error NotOpenRoom();
    error NotExpired();
    error StalePrice();
    error TooManyPlayers();
    error NoPlayers();

    constructor(IERC20 _asset, XorrVault _vault, IXorrOracle _oracle, address _owner) Owned(_owner) {
        asset = _asset;
        vault = _vault;
        oracle = _oracle;
        emit OracleSet(address(_oracle));
    }

    // ------------------------------------------------------------------ play

    function createRoom(
        bytes8 code,
        bytes32 marketId,
        uint128 stake,
        uint32 blocksAhead,
        uint8 maxPlayers,
        uint128 low,
        uint128 high
    ) external nonReentrant whenNotPaused returns (uint64 id) {
        if (roomByCode[code] != 0) revert CodeTaken();
        if (maxPlayers < 2 || maxPlayers > MAX_PLAYERS_CEILING) revert TooManyPlayers();
        if (blocksAhead < minBlocks || blocksAhead > maxBlocks) revert BadHorizon();

        id = nextRoomId++;
        rooms[id] = Room({
            marketId: marketId,
            creator: msg.sender,
            openBlock: uint48(block.number),
            expiryBlock: uint48(block.number + blocksAhead),
            stake: stake,
            settledPrice: 0,
            maxPlayers: maxPlayers,
            status: STATUS_OPEN,
            code: code
        });
        roomByCode[code] = id;

        emit RoomCreated(id, code, msg.sender, marketId, stake, uint48(block.number + blocksAhead), maxPlayers);
        _join(id, low, high);
    }

    function join(uint64 id, uint128 low, uint128 high) external nonReentrant whenNotPaused {
        _join(id, low, high);
    }

    function joinByCode(bytes8 code, uint128 low, uint128 high) external nonReentrant whenNotPaused {
        uint64 id = roomByCode[code];
        if (id == 0) revert UnknownRoom();
        _join(id, low, high);
    }

    function _join(uint64 id, uint128 low, uint128 high) internal {
        Room memory r = rooms[id];
        if (r.status != STATUS_OPEN) revert NotOpenRoom();
        if (block.number >= r.expiryBlock) revert NotOpenRoom();
        if (_entries[id].length >= r.maxPlayers) revert RoomFull();
        if (joined[id][msg.sender]) revert AlreadyJoined();
        if (low >= high || low == 0) revert BadBand();

        joined[id][msg.sender] = true;
        _entries[id].push(Entry({player: msg.sender, low: low, high: high, won: false}));

        asset.safeTransferFrom(msg.sender, address(this), r.stake);
        emit RoomJoined(id, msg.sender, low, high, uint8(_entries[id].length));
    }

    // ---------------------------------------------------------------- settle

    /// @notice Anyone can poke a room once its cutoff block has passed.
    function settleRoom(uint64 id) external nonReentrant {
        Room storage r = rooms[id];
        if (r.status != STATUS_OPEN) revert NotOpenRoom();
        if (block.number < r.expiryBlock) revert NotExpired();

        Entry[] storage es = _entries[id];
        uint256 n = es.length;
        if (n == 0) revert NoPlayers();

        bool pastWindow = block.number > uint256(r.expiryBlock) + settleWindowBlocks;
        (uint256 price, uint256 updatedAt) = oracle.latest(r.marketId);
        bool fresh = price != 0 && block.timestamp <= updatedAt + maxStaleness;

        if (!fresh && !pastWindow) revert StalePrice();

        uint256 pot = uint256(r.stake) * n;

        // Dead feed past the window: everyone gets their stake back, no fee.
        if (!fresh) {
            r.status = STATUS_VOID;
            for (uint256 i = 0; i < n; i++) {
                asset.safeTransfer(es[i].player, r.stake);
            }
            emit RoomVoided(id);
            return;
        }

        r.settledPrice = uint128(price);
        r.status = STATUS_SETTLED;

        uint256 winners;
        for (uint256 i = 0; i < n; i++) {
            if (price >= es[i].low && price <= es[i].high) {
                es[i].won = true;
                unchecked {
                    winners++;
                }
            }
        }

        uint256 fee;
        uint256 paid;

        if (winners == 0) {
            // Nobody landed inside: the house keeps dust, the rest goes home.
            fee = (pot * dustFeeBps) / BPS;
            uint256 refund = (pot - fee) / n;
            for (uint256 i = 0; i < n; i++) {
                asset.safeTransfer(es[i].player, refund);
                paid += refund;
            }
        } else {
            fee = (pot * roomFeeBps) / BPS;
            uint256 share = (pot - fee) / winners;
            for (uint256 i = 0; i < n; i++) {
                if (es[i].won) {
                    asset.safeTransfer(es[i].player, share);
                    paid += share;
                }
            }
        }

        // Fee plus integer-division dust goes to the vault, so the pot always closes out.
        uint256 toVault = pot - paid;
        if (toVault != 0) asset.safeTransfer(address(vault), toVault);

        emit RoomSettled(id, uint128(price), uint8(winners), paid, toVault);
    }

    // ----------------------------------------------------------------- views

    function entries(uint64 id) external view returns (Entry[] memory) {
        return _entries[id];
    }

    function playerCount(uint64 id) external view returns (uint256) {
        return _entries[id].length;
    }

    function getRoom(uint64 id) external view returns (Room memory) {
        return rooms[id];
    }

    function potOf(uint64 id) external view returns (uint256) {
        return uint256(rooms[id].stake) * _entries[id].length;
    }

    // ----------------------------------------------------------------- admin

    function setOracle(IXorrOracle o) external onlyOwner {
        oracle = o;
        emit OracleSet(address(o));
    }

    function setParams(
        uint256 _roomFeeBps,
        uint256 _dustFeeBps,
        uint256 _maxStaleness,
        uint32 _settleWindowBlocks,
        uint32 _minBlocks,
        uint32 _maxBlocks
    ) external onlyOwner {
        require(_roomFeeBps <= 1_000 && _dustFeeBps <= 1_000, "fee");
        require(_minBlocks > 0 && _maxBlocks >= _minBlocks, "horizon");
        roomFeeBps = _roomFeeBps;
        dustFeeBps = _dustFeeBps;
        maxStaleness = _maxStaleness;
        settleWindowBlocks = _settleWindowBlocks;
        minBlocks = _minBlocks;
        maxBlocks = _maxBlocks;
    }
}
