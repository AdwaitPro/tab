// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {TabEscrow} from "../src/TabEscrow.sol";

contract TabEscrowFuzzTest is BaseTest {
    uint128 internal constant MAX_AMOUNT = 1e12;

    function testFuzz_resolve_conservesFunds(uint128 amount, uint16 bps) public {
        amount = uint128(bound(amount, 1, MAX_AMOUNT));
        bps = uint16(bound(bps, 0, 10_000));
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, amount, uint64(block.timestamp + 1 days), REVIEW, arbiter, TERMS);
        vm.prank(buyer);
        escrow.dispute(id);

        uint256 total = usdc.balanceOf(buyer) + usdc.balanceOf(seller);
        vm.prank(arbiter);
        escrow.resolve(id, bps);

        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(buyer) + usdc.balanceOf(seller), total + amount);
        assertLe(usdc.balanceOf(seller), 1e15 + (uint256(amount) * bps) / 10_000);
    }

    function testFuzz_deal_refundOnlyAfterDeadline(uint128 amount, uint64 horizon, uint64 at) public {
        amount = uint128(bound(amount, 1, MAX_AMOUNT));
        horizon = uint64(bound(horizon, 1, 365 days));
        uint64 deliverBy = uint64(block.timestamp) + horizon;
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, amount, deliverBy, REVIEW, address(0), TERMS);

        at = uint64(bound(at, block.timestamp, uint256(deliverBy) + 365 days));
        vm.warp(at);
        vm.prank(buyer);
        if (at < deliverBy) vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.refund(id);
    }

    function testFuzz_deal_claimOnlyAfterReview(uint64 review, uint64 deliverDelay, uint64 at) public {
        review = uint64(bound(review, 1 minutes, 30 days));
        uint64 deliverBy = uint64(block.timestamp + 10 days);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMOUNT, deliverBy, review, address(0), TERMS);

        deliverDelay = uint64(bound(deliverDelay, 0, 10 days - 1));
        vm.warp(block.timestamp + deliverDelay);
        vm.prank(seller);
        escrow.markDelivered(id);

        uint256 unlock = block.timestamp + review;
        at = uint64(bound(at, block.timestamp, unlock + 30 days));
        vm.warp(at);
        vm.prank(seller);
        if (at < unlock) vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.claim(id);
    }

    function testFuzz_priceBet_winnerMatchesRule(uint128 stake, int256 price, int256 threshold, bool above) public {
        stake = uint128(bound(stake, 1, MAX_AMOUNT));
        threshold = bound(threshold, 1, 1e18);
        price = bound(price, 1, 1e18);
        uint64 joinBy = uint64(block.timestamp + 1 hours);
        uint64 resolveAt = uint64(block.timestamp + 1 days);
        vm.prank(buyer);
        uint256 id = escrow.createPriceBet(seller, stake, joinBy, resolveAt, address(ethFeed), threshold, above, TERMS);
        vm.prank(seller);
        escrow.joinBet(id);

        vm.warp(resolveAt);
        uint80 roundId = _price(price);
        address expected = (above ? price >= threshold : price < threshold) ? buyer : seller;
        uint256 before = usdc.balanceOf(expected);
        escrow.settlePrice(id, roundId);
        assertEq(usdc.balanceOf(expected), before + 2 * uint256(stake));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testFuzz_bet_joinWindow(uint64 joinWindow, uint64 at) public {
        joinWindow = uint64(bound(joinWindow, 1, 365 days));
        uint64 joinBy = uint64(block.timestamp) + joinWindow;
        vm.prank(buyer);
        uint256 id = escrow.createMutualBet(address(0), AMOUNT, joinBy, joinBy + 10 minutes, address(0), TERMS);

        at = uint64(bound(at, block.timestamp, uint256(joinBy) + 365 days));
        vm.warp(at);
        vm.prank(seller);
        if (at >= joinBy) vm.expectRevert(TabEscrow.JoinClosed.selector);
        escrow.joinBet(id);
    }
}
