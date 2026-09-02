// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Two-step ownership. Deliberately tiny: XORR ships no external deps so
///         `forge build` is reproducible from a bare clone.
abstract contract Owned {
    address public owner;
    address public pendingOwner;

    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}

abstract contract ReentrancyGuard {
    uint256 private _lock = 1;

    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }
}

abstract contract Pausable is Owned {
    bool public paused;

    event PausedSet(bool paused);

    error IsPaused();

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }
}
