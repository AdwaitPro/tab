// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {TabEscrow} from "../src/TabEscrow.sol";

contract TabEscrowConstructorTest is BaseTest {
    function _deploy(address token, address seq, address[] memory feeds, uint32[] memory st) internal {
        new TabEscrow(IERC20(token), seq, feeds, st);
    }

    function test_constructor_setsConfig() public view {
        assertEq(address(escrow.token()), address(usdc));
        assertEq(address(escrow.sequencerUptimeFeed()), address(sequencer));
        assertEq(escrow.maxStaleness(address(ethFeed)), STALENESS);
        assertEq(escrow.maxStaleness(stranger), 0);
        assertEq(escrow.nextDealId(), 1);
        assertEq(escrow.nextBetId(), 1);
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(TabEscrow.ZeroAddress.selector);
        _deploy(address(0), address(sequencer), new address[](0), new uint32[](0));
    }

    function test_constructor_revertsOnZeroSequencer() public {
        vm.expectRevert(TabEscrow.ZeroAddress.selector);
        _deploy(address(usdc), address(0), new address[](0), new uint32[](0));
    }

    function test_constructor_revertsOnLengthMismatch() public {
        vm.expectRevert(TabEscrow.LengthMismatch.selector);
        _deploy(address(usdc), address(sequencer), new address[](1), new uint32[](0));
    }

    function test_constructor_revertsOnZeroFeed() public {
        uint32[] memory st = new uint32[](1);
        st[0] = 1;
        vm.expectRevert(TabEscrow.ZeroAddress.selector);
        _deploy(address(usdc), address(sequencer), new address[](1), st);
    }

    function test_constructor_revertsOnZeroStaleness() public {
        address[] memory feeds = new address[](1);
        feeds[0] = address(ethFeed);
        vm.expectRevert(TabEscrow.InvalidStaleness.selector);
        _deploy(address(usdc), address(sequencer), feeds, new uint32[](1));
    }

    function test_constructor_revertsOnDuplicateFeed() public {
        address[] memory feeds = new address[](2);
        feeds[0] = address(ethFeed);
        feeds[1] = address(ethFeed);
        uint32[] memory st = new uint32[](2);
        st[0] = 1;
        st[1] = 1;
        vm.expectRevert(abi.encodeWithSelector(TabEscrow.DuplicateFeed.selector, address(ethFeed)));
        _deploy(address(usdc), address(sequencer), feeds, st);
    }
}

contract TabEscrowDealsTest is BaseTest {
    // ── createDeal ──

    function test_createDeal_locksFundsAndStoresDeal() public {
        uint64 deliverBy = uint64(block.timestamp + 7 days);
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealCreated(1, buyer, seller, arbiter, AMOUNT, deliverBy, REVIEW, TERMS);
        uint256 id = _createDeal(arbiter);

        assertEq(id, 1);
        assertEq(escrow.nextDealId(), 2);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        TabEscrow.Deal memory d = escrow.getDeal(id);
        assertEq(d.buyer, buyer);
        assertEq(d.seller, seller);
        assertEq(d.arbiter, arbiter);
        assertEq(d.amount, AMOUNT);
        assertEq(d.deliverBy, deliverBy);
        assertEq(d.reviewWindow, REVIEW);
        assertEq(d.deliveredAt, 0);
        assertEq(uint8(d.state), uint8(TabEscrow.DealState.Funded));
        assertEq(d.termsHash, TERMS);
        assertEq(d.disputedAt, 0);
    }

    function test_createDeal_revertsOnZeroSeller() public {
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidCounterparty.selector);
        escrow.createDeal(address(0), AMOUNT, uint64(block.timestamp + 1), REVIEW, address(0), TERMS);
    }

    function test_createDeal_revertsOnSelfDeal() public {
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidCounterparty.selector);
        escrow.createDeal(buyer, AMOUNT, uint64(block.timestamp + 1), REVIEW, address(0), TERMS);
    }

    function test_createDeal_revertsOnZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidAmount.selector);
        escrow.createDeal(seller, 0, uint64(block.timestamp + 1), REVIEW, address(0), TERMS);
    }

    function test_createDeal_revertsOnDeadlineNotInFuture() public {
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidDeadline.selector);
        escrow.createDeal(seller, AMOUNT, uint64(block.timestamp), REVIEW, address(0), TERMS);
    }

    function test_createDeal_reviewWindowBounds() public {
        uint64 deliverBy = uint64(block.timestamp + 1);
        vm.startPrank(buyer);
        vm.expectRevert(TabEscrow.InvalidReviewWindow.selector);
        escrow.createDeal(seller, AMOUNT, deliverBy, 1 minutes - 1, address(0), TERMS);
        vm.expectRevert(TabEscrow.InvalidReviewWindow.selector);
        escrow.createDeal(seller, AMOUNT, deliverBy, 30 days + 1, address(0), TERMS);
        escrow.createDeal(seller, AMOUNT, deliverBy, 1 minutes, address(0), TERMS);
        escrow.createDeal(seller, AMOUNT, deliverBy, 30 days, address(0), TERMS);
        vm.stopPrank();
    }

    function test_createDeal_revertsOnArbiterIsParty() public {
        vm.startPrank(buyer);
        vm.expectRevert(TabEscrow.InvalidArbiter.selector);
        escrow.createDeal(seller, AMOUNT, uint64(block.timestamp + 1), REVIEW, buyer, TERMS);
        vm.expectRevert(TabEscrow.InvalidArbiter.selector);
        escrow.createDeal(seller, AMOUNT, uint64(block.timestamp + 1), REVIEW, seller, TERMS);
        vm.stopPrank();
    }

    function test_createDeal_revertsWithoutAllowance() public {
        vm.prank(buyer);
        usdc.approve(address(escrow), AMOUNT - 1);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.createDeal(seller, AMOUNT, uint64(block.timestamp + 1), REVIEW, address(0), TERMS);
    }

    // ── markDelivered ──

    function test_markDelivered_setsDelivered() public {
        uint256 id = _createDeal(address(0));
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealDelivered(id, uint64(block.timestamp));
        vm.prank(seller);
        escrow.markDelivered(id);
        TabEscrow.Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(TabEscrow.DealState.Delivered));
        assertEq(d.deliveredAt, block.timestamp);
    }

    function test_markDelivered_revertsForNonSeller() public {
        uint256 id = _createDeal(address(0));
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.NotSeller.selector);
        escrow.markDelivered(id);
    }

    function test_markDelivered_revertsWhenNotFunded() public {
        uint256 id = _createDeal(address(0));
        vm.startPrank(seller);
        escrow.markDelivered(id);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.markDelivered(id);
        vm.stopPrank();
    }

    function test_markDelivered_deadlineBoundary() public {
        uint256 id = _createDeal(address(0));
        uint64 deliverBy = escrow.getDeal(id).deliverBy;
        vm.warp(deliverBy);
        vm.prank(seller);
        vm.expectRevert(TabEscrow.TooLate.selector);
        escrow.markDelivered(id);

        vm.warp(deliverBy - 1);
        vm.prank(seller);
        escrow.markDelivered(id);
    }

    // ── release ──

    function test_release_fromFunded() public {
        uint256 id = _createDeal(address(0));
        uint256 before = usdc.balanceOf(seller);
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealReleased(id, AMOUNT);
        vm.prank(buyer);
        escrow.release(id);
        assertEq(usdc.balanceOf(seller), before + AMOUNT);
        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Released));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_release_fromDelivered() public {
        uint256 id = _createDeal(address(0));
        vm.prank(seller);
        escrow.markDelivered(id);
        vm.prank(buyer);
        escrow.release(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Released));
    }

    function test_release_revertsForNonBuyer() public {
        uint256 id = _createDeal(address(0));
        vm.prank(seller);
        vm.expectRevert(TabEscrow.NotBuyer.selector);
        escrow.release(id);
    }

    function test_release_revertsWhenTerminal() public {
        uint256 id = _createDeal(address(0));
        vm.startPrank(buyer);
        escrow.release(id);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.release(id);
        vm.stopPrank();
    }

    function test_unknownDeal_revertsForEveryone() public {
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.NotBuyer.selector);
        escrow.release(42);
        assertEq(uint8(escrow.getDeal(42).state), uint8(TabEscrow.DealState.None));
    }

    // ── claim ──

    function test_claim_reviewWindowBoundary() public {
        uint256 id = _createDeal(address(0));
        vm.prank(seller);
        escrow.markDelivered(id);
        uint256 deliveredAt = block.timestamp;

        vm.warp(deliveredAt + REVIEW - 1);
        vm.prank(seller);
        vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.claim(id);

        vm.warp(deliveredAt + REVIEW);
        uint256 before = usdc.balanceOf(seller);
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealClaimed(id, AMOUNT);
        vm.prank(seller);
        escrow.claim(id);
        assertEq(usdc.balanceOf(seller), before + AMOUNT);
        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Released));
    }

    function test_claim_revertsForNonSeller() public {
        uint256 id = _createDeal(address(0));
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.NotSeller.selector);
        escrow.claim(id);
    }

    function test_claim_revertsWhenNotDelivered() public {
        uint256 id = _createDeal(address(0));
        vm.warp(block.timestamp + 365 days);
        vm.prank(seller);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.claim(id);
    }

    // ── refund ──

    function test_refund_afterDeadlineBoundary() public {
        uint256 id = _createDeal(address(0));
        uint64 deliverBy = escrow.getDeal(id).deliverBy;

        vm.warp(deliverBy - 1);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.refund(id);

        vm.warp(deliverBy);
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealRefunded(id, AMOUNT, true);
        vm.prank(buyer);
        escrow.refund(id);
        assertEq(usdc.balanceOf(buyer), before + AMOUNT);
        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Refunded));
    }

    function test_refund_fundedRevertsForNonBuyer() public {
        uint256 id = _createDeal(address(0));
        vm.warp(block.timestamp + 8 days);
        vm.prank(seller);
        vm.expectRevert(TabEscrow.NotBuyer.selector);
        escrow.refund(id);
    }

    function test_refund_revertsWhenDelivered() public {
        uint256 id = _createDeal(address(0));
        vm.prank(seller);
        escrow.markDelivered(id);
        vm.warp(block.timestamp + 365 days);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.refund(id);
    }

    function test_refund_disputedAfterArbiterTimeoutBoundary() public {
        uint256 id = _createDeal(arbiter);
        vm.warp(block.timestamp + 3 days);
        vm.prank(buyer);
        escrow.dispute(id);
        TabEscrow.Deal memory d = escrow.getDeal(id);
        assertEq(d.disputedAt, block.timestamp);
        uint256 unlock = uint256(d.disputedAt) + escrow.DISPUTE_TIMEOUT();

        vm.warp(unlock - 1);
        vm.prank(seller);
        vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.refund(id);

        vm.warp(unlock);
        vm.prank(stranger);
        vm.expectRevert(TabEscrow.NotParty.selector);
        escrow.refund(id);

        uint256 before = usdc.balanceOf(buyer);
        vm.prank(seller);
        escrow.refund(id);
        assertEq(usdc.balanceOf(buyer), before + AMOUNT);
        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Refunded));
    }

    // ── cancelBySeller ──

    function test_cancelBySeller_refundsBuyer() public {
        uint256 id = _createDeal(address(0));
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealRefunded(id, AMOUNT, false);
        vm.prank(seller);
        escrow.cancelBySeller(id);
        assertEq(usdc.balanceOf(buyer), before + AMOUNT);
        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Refunded));
    }

    function test_cancelBySeller_revertsForNonSeller() public {
        uint256 id = _createDeal(address(0));
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.NotSeller.selector);
        escrow.cancelBySeller(id);
    }

    function test_cancelBySeller_revertsWhenDelivered() public {
        uint256 id = _createDeal(address(0));
        vm.startPrank(seller);
        escrow.markDelivered(id);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.cancelBySeller(id);
        vm.stopPrank();
    }

    // ── dispute ──

    function test_dispute_byEitherParty() public {
        uint256 a = _createDeal(arbiter);
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealDisputed(a, buyer);
        vm.prank(buyer);
        escrow.dispute(a);
        assertEq(uint8(escrow.getDeal(a).state), uint8(TabEscrow.DealState.Disputed));

        uint256 b = _createDeal(arbiter);
        vm.startPrank(seller);
        escrow.markDelivered(b);
        escrow.dispute(b);
        vm.stopPrank();
        assertEq(uint8(escrow.getDeal(b).state), uint8(TabEscrow.DealState.Disputed));
    }

    function test_dispute_freezesOtherExits() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(seller);
        escrow.markDelivered(id);
        vm.prank(buyer);
        escrow.dispute(id);
        vm.warp(block.timestamp + 10 days);

        vm.prank(seller);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.claim(id);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.release(id);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.dispute(id);
    }

    function test_dispute_fundedClosesAtDeliverBy() public {
        uint256 id = _createDeal(arbiter);
        uint64 deliverBy = escrow.getDeal(id).deliverBy;
        vm.warp(deliverBy);
        vm.prank(seller);
        vm.expectRevert(TabEscrow.TooLate.selector);
        escrow.dispute(id);
        vm.warp(deliverBy - 1);
        vm.prank(seller);
        escrow.dispute(id);
    }

    function test_dispute_deliveredClosesAtReviewEnd() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(seller);
        escrow.markDelivered(id);
        uint256 reviewEnd = block.timestamp + REVIEW;
        vm.warp(reviewEnd);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.TooLate.selector);
        escrow.dispute(id);
        vm.warp(reviewEnd - 1);
        vm.prank(buyer);
        escrow.dispute(id);
    }

    function test_dispute_revertsWhenTerminal() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(buyer);
        escrow.release(id);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.dispute(id);
    }

    function test_dispute_revertsForNonParty() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.NotParty.selector);
        escrow.dispute(id);
    }

    function test_dispute_revertsWithoutArbiter() public {
        uint256 id = _createDeal(address(0));
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.NoArbiter.selector);
        escrow.dispute(id);
    }

    // ── resolve ──

    function test_resolve_splitsByBps() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(buyer);
        escrow.dispute(id);
        uint256 sellerBefore = usdc.balanceOf(seller);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        uint128 sellerAmount = uint128(uint256(AMOUNT) * 3333 / 10_000);
        vm.expectEmit(address(escrow));
        emit TabEscrow.DealResolved(id, sellerAmount, AMOUNT - sellerAmount);
        vm.prank(arbiter);
        escrow.resolve(id, 3333);

        assertEq(usdc.balanceOf(seller), sellerBefore + sellerAmount);
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT - sellerAmount);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getDeal(id).state), uint8(TabEscrow.DealState.Resolved));
    }

    function test_resolve_extremes() public {
        uint256 a = _createDeal(arbiter);
        uint256 b = _createDeal(arbiter);
        vm.startPrank(buyer);
        escrow.dispute(a);
        escrow.dispute(b);
        vm.stopPrank();

        uint256 sellerBefore = usdc.balanceOf(seller);
        vm.prank(arbiter);
        escrow.resolve(a, 10_000);
        assertEq(usdc.balanceOf(seller), sellerBefore + AMOUNT);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(arbiter);
        escrow.resolve(b, 0);
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT);
    }

    function test_resolve_revertsForNonArbiter() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(buyer);
        escrow.dispute(id);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.NotArbiter.selector);
        escrow.resolve(id, 0);
    }

    function test_resolve_revertsWhenNoArbiterEvenForZeroAddress() public {
        uint256 id = _createDeal(address(0));
        vm.prank(address(0));
        vm.expectRevert(TabEscrow.NotArbiter.selector);
        escrow.resolve(id, 0);
    }

    function test_resolve_revertsWhenNotDisputed() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.resolve(id, 0);
    }

    function test_resolve_revertsOnBpsAboveMax() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(seller);
        escrow.dispute(id);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.InvalidBps.selector);
        escrow.resolve(id, 10_001);
    }

    function test_resolve_stillPossibleAfterTimeoutUntilRefunded() public {
        uint256 id = _createDeal(arbiter);
        vm.prank(buyer);
        escrow.dispute(id);
        vm.warp(block.timestamp + 365 days);
        vm.prank(arbiter);
        escrow.resolve(id, 5000);
        vm.prank(buyer);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.refund(id);
    }
}
