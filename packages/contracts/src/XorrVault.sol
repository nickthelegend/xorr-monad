// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {Owned, Pausable, ReentrancyGuard} from "./lib/Auth.sol";

/// @title XorrVault
/// @notice The house bankroll. LPs deposit AUSD, markets reserve against it, and the
///         core invariant is enforced at reserve time rather than at payout time:
///
///             reserved <= totalAssets()                          (always)
///
///         `reserved` tracks the FULL payout of every open ticket, not the net
///         exposure (payout - stake). Reserving only the net would let an LP withdraw
///         the pending stake as if it were free capital and leave the vault one stake
///         short when that ticket wins. Because a ticket's stake is transferred in
///         before its payout is reserved, a reserve that passes proves the vault can
///         already cover the win in full.
///
///         LP withdrawals are therefore bounded by freeAssets() = totalAssets - reserved.
contract XorrVault is Owned, Pausable, ReentrancyGuard {
    using SafeTransfer for IERC20;

    IERC20 public immutable asset;
    uint8 public immutable assetDecimals;

    /// @notice Sum of the max payout of every open ticket. Never exceeds totalAssets().
    uint256 public reserved;

    /// @notice LP share accounting.
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    /// @notice Markets allowed to reserve/settle against the bankroll.
    mapping(address => bool) public isMarket;

    /// @notice Refuse new exposure past this utilisation. 8_000 = 80%.
    uint256 public maxUtilisationBps = 8_000;

    uint256 internal constant BPS = 10_000;

    event Deposited(address indexed lp, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lp, uint256 assets, uint256 shares);
    event Reserved(address indexed market, uint256 payout, uint256 reservedTotal);
    event Released(address indexed market, uint256 payout, uint256 reservedTotal);
    event PaidOut(address indexed market, address indexed to, uint256 amount);
    event MarketSet(address indexed market, bool allowed);
    event MaxUtilisationSet(uint256 bps);

    error NotMarket();
    error ZeroAmount();
    error OverUtilised(uint256 wouldBeBps, uint256 maxBps);
    error InsufficientFreeAssets(uint256 requested, uint256 available);
    error ReserveUnderflow();
    error BrokenInvariant();

    modifier onlyMarket() {
        if (!isMarket[msg.sender]) revert NotMarket();
        _;
    }

    constructor(IERC20 _asset, address _owner) Owned(_owner) {
        asset = _asset;
        assetDecimals = _asset.decimals();
    }

    // ---------------------------------------------------------------- views

    /// @notice Everything the vault holds, including stakes on open tickets.
    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Assets not spoken for by an open ticket. The LP withdrawal ceiling.
    function freeAssets() public view returns (uint256) {
        uint256 ta = totalAssets();
        return ta > reserved ? ta - reserved : 0;
    }

    /// @notice reserved / totalAssets in bps. Drives the desk's battery meter.
    function utilisationBps() public view returns (uint256) {
        uint256 ta = totalAssets();
        if (ta == 0) return reserved == 0 ? 0 : BPS;
        return (reserved * BPS) / ta;
    }

    /// @notice Largest payout the vault would accept right now.
    function maxPayout() public view returns (uint256) {
        uint256 ceiling = (totalAssets() * maxUtilisationBps) / BPS;
        return ceiling > reserved ? ceiling - reserved : 0;
    }

    /// @dev Virtual-offset share pricing (ERC4626 style) to defuse the classic
    ///      first-depositor inflation attack without a dead-shares dance.
    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * (totalShares + 1)) / (totalAssets() + 1);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * (totalAssets() + 1)) / (totalShares + 1);
    }

    // ------------------------------------------------------------------ LP

    function deposit(uint256 assets) external nonReentrant whenNotPaused returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        shares = convertToShares(assets);
        if (shares == 0) revert ZeroAmount();

        totalShares += shares;
        sharesOf[msg.sender] += shares;

        asset.safeTransferFrom(msg.sender, address(this), assets);
        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Burn shares for assets. Capped by freeAssets so open tickets stay funded.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        assets = convertToAssets(shares);

        uint256 free = freeAssets();
        if (assets > free) revert InsufficientFreeAssets(assets, free);

        totalShares -= shares;
        sharesOf[msg.sender] -= shares;

        asset.safeTransfer(msg.sender, assets);
        _checkInvariant();
        emit Withdrawn(msg.sender, assets, shares);
    }

    // -------------------------------------------------------------- markets

    /// @notice Book the full payout of a freshly opened ticket.
    /// @dev Called only after the stake has landed in this contract, so a passing
    ///      check means the win is already funded.
    function reserve(uint256 payout) external onlyMarket whenNotPaused {
        uint256 next = reserved + payout;
        uint256 ceiling = (totalAssets() * maxUtilisationBps) / BPS;
        if (next > ceiling) {
            uint256 ta = totalAssets();
            revert OverUtilised(ta == 0 ? BPS : (next * BPS) / ta, maxUtilisationBps);
        }
        reserved = next;
        _checkInvariant();
        emit Reserved(msg.sender, payout, next);
    }

    /// @notice Release a reservation on a losing ticket. The stake stays as LP profit.
    function release(uint256 payout) public onlyMarket {
        if (payout > reserved) revert ReserveUnderflow();
        reserved -= payout;
        emit Released(msg.sender, payout, reserved);
    }

    /// @notice Release and pay a winning ticket in one hop.
    function releaseAndPay(uint256 payout, address to, uint256 amount) external onlyMarket nonReentrant {
        release(payout);
        if (amount != 0) {
            asset.safeTransfer(to, amount);
            emit PaidOut(msg.sender, to, amount);
        }
        _checkInvariant();
    }

    /// @notice Straight transfer out of unreserved capital (room fees, refunds).
    function pay(address to, uint256 amount) external onlyMarket nonReentrant {
        if (amount > freeAssets()) revert InsufficientFreeAssets(amount, freeAssets());
        asset.safeTransfer(to, amount);
        _checkInvariant();
        emit PaidOut(msg.sender, to, amount);
    }

    // ---------------------------------------------------------------- admin

    function setMarket(address market, bool allowed) external onlyOwner {
        isMarket[market] = allowed;
        emit MarketSet(market, allowed);
    }

    function setMaxUtilisation(uint256 bps) external onlyOwner {
        require(bps <= BPS, "bps");
        maxUtilisationBps = bps;
        emit MaxUtilisationSet(bps);
    }

    /// @dev The one line that makes insolvency unreachable.
    function _checkInvariant() internal view {
        if (reserved > totalAssets()) revert BrokenInvariant();
    }
}
