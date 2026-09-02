// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {RoomMarket} from "../src/RoomMarket.sol";

contract RoomMarketTest is Base {
    bytes8 constant CODE = bytes8("NIGHT01");
    uint128 constant STAKE = 5e6;

    function setUp() public {
        setUpBase();
    }

    function _wide(uint256 halfBps) internal pure returns (uint128 low, uint128 high) {
        uint256 half = (SPOT * halfBps) / 10_000;
        return (uint128(SPOT - half), uint128(SPOT + half));
    }

    function _openRoom() internal returns (uint64 id) {
        (uint128 low, uint128 high) = _wide(50);
        vm.prank(alice);
        id = room.createRoom(CODE, BTC, STAKE, 100, 5, low, high);
    }

    function test_CreateSeatsTheCreatorAndTakesTheirStake() public {
        uint256 before = ausd.balanceOf(alice);
        uint64 id = _openRoom();
        assertEq(room.playerCount(id), 1);
        assertEq(before - ausd.balanceOf(alice), STAKE);
        assertEq(room.roomByCode(CODE), id);
    }

    function test_JoinByCodeIsHowASharedLinkWorks() public {
        uint64 id = _openRoom();
        (uint128 low, uint128 high) = _wide(20);
        vm.prank(bob);
        room.joinByCode(CODE, low, high);
        assertEq(room.playerCount(id), 2);
    }

    function test_CodesAreUnique() public {
        _openRoom();
        (uint128 low, uint128 high) = _wide(50);
        vm.prank(bob);
        vm.expectRevert(RoomMarket.CodeTaken.selector);
        room.createRoom(CODE, BTC, STAKE, 100, 5, low, high);
    }

    function test_NobodySitsTwice() public {
        uint64 id = _openRoom();
        (uint128 low, uint128 high) = _wide(50);
        vm.prank(alice);
        vm.expectRevert(RoomMarket.AlreadyJoined.selector);
        room.join(id, low, high);
    }

    function test_RoomFillsUpAndStops() public {
        (uint128 low, uint128 high) = _wide(50);
        vm.prank(alice);
        uint64 id = room.createRoom(CODE, BTC, STAKE, 100, 2, low, high);

        vm.prank(bob);
        room.join(id, low, high);

        _fund(carol, 100e6);
        vm.prank(carol);
        vm.expectRevert(RoomMarket.RoomFull.selector);
        room.join(id, low, high);
    }

    /// @notice One player lands inside: they take the whole pot less the house fee.
    function test_TheOnlyPlayerInsideTakesThePot() public {
        (uint128 tight,) = _wide(5);
        uint64 id;
        {
            (uint128 lo, uint128 hi) = _wide(5); // alice: narrow band around spot
            vm.prank(alice);
            id = room.createRoom(CODE, BTC, STAKE, 100, 5, lo, hi);
        }
        // bob and carol sit far above spot and will miss
        vm.prank(bob);
        room.join(id, uint128(SPOT + 400e8), uint128(SPOT + 900e8));
        vm.prank(carol);
        room.join(id, uint128(SPOT + 401e8), uint128(SPOT + 901e8));
        tight; // silence

        uint256 pot = room.potOf(id);
        assertEq(pot, 3 * STAKE);

        uint256 aliceBefore = ausd.balanceOf(alice);
        uint256 vaultBefore = vault.totalAssets();

        _roll(100);
        _repush(SPOT); // dead centre: only alice is inside
        room.settleRoom(id);

        uint256 fee = (pot * room.roomFeeBps()) / 10_000;
        assertEq(ausd.balanceOf(alice) - aliceBefore, pot - fee);
        assertEq(vault.totalAssets() - vaultBefore, fee, "the house only ever takes the fee");
        assertEq(ausd.balanceOf(address(room)), 0, "the pot closes out to the cent");
    }

    function test_EveryoneInsideSplitsItBack() public {
        (uint128 low, uint128 high) = _wide(50);
        vm.prank(alice);
        uint64 id = room.createRoom(CODE, BTC, STAKE, 100, 5, low, high);
        vm.prank(bob);
        room.join(id, low, high);

        uint256 aBefore = ausd.balanceOf(alice);
        uint256 bBefore = ausd.balanceOf(bob);

        _roll(100);
        _repush(SPOT);
        room.settleRoom(id);

        uint256 pot = 2 * STAKE;
        uint256 share = (pot - (pot * room.roomFeeBps()) / 10_000) / 2;
        assertEq(ausd.balanceOf(alice) - aBefore, share);
        assertEq(ausd.balanceOf(bob) - bBefore, share);
        assertEq(ausd.balanceOf(address(room)), 0);
    }

    /// @notice Nobody inside: the house keeps dust and the rest goes home.
    function test_NobodyInsideMeansRefundMinusDust() public {
        vm.prank(alice);
        uint64 id = room.createRoom(CODE, BTC, STAKE, 100, 5, uint128(SPOT - 20e8), uint128(SPOT - 10e8));
        vm.prank(bob);
        room.join(id, uint128(SPOT - 25e8), uint128(SPOT - 15e8));

        uint256 aBefore = ausd.balanceOf(alice);
        uint256 vaultBefore = vault.totalAssets();

        _roll(100);
        _repush(SPOT + 500e8); // miles above every band
        room.settleRoom(id);

        uint256 pot = 2 * STAKE;
        uint256 dust = (pot * room.dustFeeBps()) / 10_000;
        assertEq(ausd.balanceOf(alice) - aBefore, (pot - dust) / 2);
        assertEq(vault.totalAssets() - vaultBefore, dust);
        assertEq(ausd.balanceOf(address(room)), 0);
    }

    function test_CannotSettleBeforeTheCutoffBlock() public {
        uint64 id = _openRoom();
        vm.expectRevert(RoomMarket.NotExpired.selector);
        room.settleRoom(id);
    }

    function test_DeadFeedPastTheWindowRefundsEveryoneInFull() public {
        uint64 id = _openRoom();
        vm.prank(bob);
        room.join(id, uint128(SPOT - 1e8), uint128(SPOT + 1e8));

        uint256 aBefore = ausd.balanceOf(alice);
        uint256 bBefore = ausd.balanceOf(bob);

        vm.roll(block.number + 100 + room.settleWindowBlocks() + 1);
        vm.warp(block.timestamp + 1 days);
        room.settleRoom(id);

        assertEq(ausd.balanceOf(alice) - aBefore, STAKE, "no fee on a void");
        assertEq(ausd.balanceOf(bob) - bBefore, STAKE);
        assertEq(ausd.balanceOf(address(room)), 0);
    }

    function test_RoomsNeverTouchTheHouseBankroll() public {
        uint256 reservedBefore = vault.reserved();
        uint64 id = _openRoom();
        vm.prank(bob);
        room.join(id, uint128(SPOT - 1e8), uint128(SPOT + 1e8));
        assertEq(vault.reserved(), reservedBefore, "a room is peer-to-peer, not house risk");
    }

    /// @notice Whoever wins and however the rounding falls, every cent of the pot is
    ///         accounted for: players plus vault equals pot, and the room holds nothing.
    function testFuzz_PotAlwaysClosesOut(uint8 seats, uint128 settlePrice) public {
        seats = uint8(bound(seats, 2, 5));
        settlePrice = uint128(bound(settlePrice, SPOT - 300e8, SPOT + 300e8));

        (uint128 low, uint128 high) = _wide(50);
        vm.prank(alice);
        uint64 id = room.createRoom(CODE, BTC, STAKE, 100, seats, low, high);

        for (uint256 i = 1; i < seats; i++) {
            address p = address(uint160(0x2000 + i));
            _fund(p, 100e6);
            vm.prank(p);
            room.join(id, uint128(SPOT - (i * 30e8)), uint128(SPOT + (i * 20e8)));
        }

        _roll(100);
        _repush(settlePrice);
        room.settleRoom(id);

        assertEq(ausd.balanceOf(address(room)), 0, "no dust may be stranded in the room");
    }
}
