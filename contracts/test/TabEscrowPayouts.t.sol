// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {TabEscrow} from "../src/TabEscrow.sol";

/// @notice Pull-payment fallback: a recipient that cannot receive (USDC blacklist, transfer returning false)
///         never blocks a state transition or the counterparty; its share is credited to `owed`.
contract TabEscrowPayoutsTest is BaseTest {
    function test_payout_blockedRecipientIsCreditedAndWithdrawsLater() public {
        uint256 id = _createDeal(address(0));
        usdc.setBlocked(seller, true);

        vm.expectEmit(address(escrow));
        emit TabEscrow.PayoutDeferred(seller, AMOUNT);
        vm.prank(buyer);
        escrow.release(id);

        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Released));
        assertEq(escrow.owed(seller), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);

        vm.prank(seller);
        vm.expectRevert("Blacklistable: account is blacklisted");
        escrow.withdraw();
        assertEq(escrow.owed(seller), AMOUNT);

        usdc.setBlocked(seller, false);
        uint256 before = usdc.balanceOf(seller);
        vm.expectEmit(address(escrow));
        emit TabEscrow.Withdrawn(seller, AMOUNT);
        vm.prank(seller);
        escrow.withdraw();
        assertEq(usdc.balanceOf(seller), before + AMOUNT);
        assertEq(escrow.owed(seller), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_payout_falseReturnIsCredited() public {
        uint256 id = _createDeal(address(0));
        usdc.setReturnsFalse(seller, true);
        vm.prank(buyer);
        escrow.release(id);
        assertEq(escrow.owed(seller), AMOUNT);
    }

    function test_withdraw_revertsWhenNothingOwed() public {
        vm.prank(seller);
        vm.expectRevert(TabEscrow.NothingOwed.selector);
        escrow.withdraw();
    }

    function test_payout_resolveSplitsAroundBlockedBuyer() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(seller);
        escrow.dispute(id);
        usdc.setBlocked(buyer, true);
        uint256 sellerBefore = usdc.balanceOf(seller);
        vm.prank(arbiter);
        escrow.resolve(id, 4000);
        uint128 sellerAmount = uint128(uint256(AMOUNT) * 4000 / 10_000);
        assertEq(usdc.balanceOf(seller), sellerBefore + sellerAmount);
        assertEq(escrow.owed(buyer), AMOUNT - sellerAmount);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT - sellerAmount);
    }

    function test_payout_refundStalePaysUnblockedSide() public {
        uint64 joinBy = uint64(block.timestamp + 1 hours);
        uint64 resolveAt = uint64(block.timestamp + 1 days);
        vm.prank(buyer);
        uint256 id = escrow.createMutualBet(seller, AMOUNT, joinBy, resolveAt, address(0), TERMS);
        vm.prank(seller);
        escrow.joinBet(id);
        usdc.setBlocked(seller, true);

        vm.warp(uint256(resolveAt) + escrow.MUTUAL_REFUND_DELAY());
        uint256 before = usdc.balanceOf(buyer);
        escrow.refundStale(id);
        assertEq(usdc.balanceOf(buyer), before + AMOUNT);
        assertEq(escrow.owed(seller), AMOUNT);
    }

    function test_payout_blockedWinnerIsCreditedAndAccumulates() public {
        uint64 joinBy = uint64(block.timestamp + 1 hours);
        uint64 resolveAt = uint64(block.timestamp + 1 days);
        vm.startPrank(buyer);
        uint256 a = escrow.createPriceBet(seller, AMOUNT, joinBy, resolveAt, address(ethFeed), THRESHOLD, true, TERMS);
        uint256 dealId = escrow.createDeal(seller, AMOUNT, uint64(block.timestamp + 2 days), REVIEW, address(0), TERMS);
        vm.stopPrank();
        vm.prank(seller);
        escrow.joinBet(a);

        usdc.setBlocked(buyer, true);
        vm.prank(seller);
        escrow.cancelBySeller(dealId);
        vm.warp(resolveAt);
        escrow.settlePrice(a, _price(THRESHOLD));

        assertEq(uint8(escrow.getBet(a).state), uint8(TabEscrow.BetState.Settled));
        assertEq(escrow.owed(buyer), 3 * uint256(AMOUNT));
        assertEq(usdc.balanceOf(address(escrow)), 3 * uint256(AMOUNT));
    }
}
