// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {TabEscrow} from "../src/TabEscrow.sol";

contract TabEscrowBetsTest is BaseTest {
    address internal creator;
    address internal opponent;
    uint64 internal joinBy;
    uint64 internal resolveAt;

    function setUp() public override {
        super.setUp();
        creator = buyer;
        opponent = seller;
        joinBy = uint64(block.timestamp + 1 hours);
        resolveAt = uint64(block.timestamp + 1 days);
    }

    function _priceBet(address opp, bool above) internal returns (uint256 id) {
        vm.prank(creator);
        id = escrow.createPriceBet(opp, AMOUNT, joinBy, resolveAt, address(ethFeed), THRESHOLD, above, TERMS);
    }

    function _mutualBet(address opp, address arb) internal returns (uint256 id) {
        vm.prank(creator);
        id = escrow.createMutualBet(opp, AMOUNT, joinBy, resolveAt, arb, TERMS);
    }

    function _join(uint256 id) internal {
        vm.prank(opponent);
        escrow.joinBet(id);
    }

    function _matchedPriceBet(bool above) internal returns (uint256 id) {
        id = _priceBet(opponent, above);
        _join(id);
    }

    function _matchedMutualBet(address arb) internal returns (uint256 id) {
        id = _mutualBet(opponent, arb);
        _join(id);
    }

    /// @dev Moves to resolveAt, publishes `p` at that instant and settles on that (first) round.
    function _settleAt(uint256 id, int256 p) internal returns (uint80 roundId) {
        vm.warp(resolveAt);
        roundId = _price(p);
        escrow.settlePrice(id, roundId);
    }

    // ── createPriceBet ──

    function test_createPriceBet_storesBetAndLocksStake() public {
        vm.expectEmit(address(escrow));
        emit TabEscrow.BetCreated(
            1, TabEscrow.BetKind.Price, creator, opponent, address(0), AMOUNT, joinBy, resolveAt, TERMS
        );
        vm.expectEmit(address(escrow));
        emit TabEscrow.PriceBetTerms(1, address(ethFeed), THRESHOLD, true);
        uint256 id = _priceBet(opponent, true);

        assertEq(id, 1);
        assertEq(escrow.nextBetId(), 2);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        TabEscrow.Bet memory b = escrow.getBet(id);
        assertEq(b.creator, creator);
        assertEq(b.opponent, opponent);
        assertEq(b.arbiter, address(0));
        assertEq(b.stake, AMOUNT);
        assertEq(b.joinBy, joinBy);
        assertEq(b.resolveAt, resolveAt);
        assertEq(uint8(b.kind), uint8(TabEscrow.BetKind.Price));
        assertEq(uint8(b.state), uint8(TabEscrow.BetState.Open));
        assertEq(b.feed, address(ethFeed));
        assertEq(b.threshold, THRESHOLD);
        assertTrue(b.creatorAbove);
        assertEq(b.termsHash, TERMS);
    }

    function test_createPriceBet_revertsOnFeedNotAllowed() public {
        vm.prank(creator);
        vm.expectRevert(TabEscrow.FeedNotAllowed.selector);
        escrow.createPriceBet(opponent, AMOUNT, joinBy, resolveAt, stranger, THRESHOLD, true, TERMS);
    }

    function test_createPriceBet_revertsOnNonPositiveThreshold() public {
        vm.startPrank(creator);
        vm.expectRevert(TabEscrow.InvalidThreshold.selector);
        escrow.createPriceBet(opponent, AMOUNT, joinBy, resolveAt, address(ethFeed), 0, true, TERMS);
        vm.expectRevert(TabEscrow.InvalidThreshold.selector);
        escrow.createPriceBet(opponent, AMOUNT, joinBy, resolveAt, address(ethFeed), -1, true, TERMS);
        vm.stopPrank();
    }

    function test_createBet_revertsOnSelfOpponent() public {
        vm.prank(creator);
        vm.expectRevert(TabEscrow.InvalidCounterparty.selector);
        escrow.createPriceBet(creator, AMOUNT, joinBy, resolveAt, address(ethFeed), THRESHOLD, true, TERMS);
    }

    function test_createBet_revertsOnZeroStake() public {
        vm.prank(creator);
        vm.expectRevert(TabEscrow.InvalidAmount.selector);
        escrow.createMutualBet(opponent, 0, joinBy, resolveAt, address(0), TERMS);
    }

    function test_createBet_deadlineValidation() public {
        vm.startPrank(creator);
        vm.expectRevert(TabEscrow.InvalidDeadline.selector);
        escrow.createMutualBet(opponent, AMOUNT, uint64(block.timestamp), resolveAt, address(0), TERMS);
        vm.expectRevert(TabEscrow.InvalidDeadline.selector);
        escrow.createMutualBet(opponent, AMOUNT, joinBy, joinBy - 1, address(0), TERMS);
        uint64 minResolve = joinBy + uint64(escrow.MIN_JOIN_GAP());
        assertEq(escrow.MIN_JOIN_GAP(), 10 minutes);
        vm.expectRevert(TabEscrow.InvalidDeadline.selector);
        escrow.createMutualBet(opponent, AMOUNT, joinBy, minResolve - 1, address(0), TERMS);
        escrow.createMutualBet(opponent, AMOUNT, joinBy, minResolve, address(0), TERMS);
        vm.stopPrank();
    }

    // ── createMutualBet ──

    function test_createMutualBet_storesArbiter() public {
        uint256 id = _mutualBet(address(0), arbiter);
        TabEscrow.Bet memory b = escrow.getBet(id);
        assertEq(uint8(b.kind), uint8(TabEscrow.BetKind.Mutual));
        assertEq(b.arbiter, arbiter);
        assertEq(b.opponent, address(0));
        assertEq(b.feed, address(0));
    }

    function test_createMutualBet_revertsOnArbiterIsParty() public {
        vm.startPrank(creator);
        vm.expectRevert(TabEscrow.InvalidArbiter.selector);
        escrow.createMutualBet(opponent, AMOUNT, joinBy, resolveAt, creator, TERMS);
        vm.expectRevert(TabEscrow.InvalidArbiter.selector);
        escrow.createMutualBet(opponent, AMOUNT, joinBy, resolveAt, opponent, TERMS);
        vm.stopPrank();
    }

    // ── joinBet ──

    function test_joinBet_invitedOpponent() public {
        uint256 id = _priceBet(opponent, true);
        vm.expectEmit(address(escrow));
        emit TabEscrow.BetJoined(id, opponent);
        _join(id);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Matched));
        assertEq(usdc.balanceOf(address(escrow)), 2 * uint256(AMOUNT));
    }

    function test_joinBet_openToAnyone() public {
        uint256 id = _priceBet(address(0), true);
        vm.prank(stranger);
        escrow.joinBet(id);
        assertEq(escrow.getBet(id).opponent, stranger);
    }

    function test_joinBet_revertsForUninvited() public {
        uint256 id = _priceBet(opponent, true);
        vm.prank(stranger);
        vm.expectRevert(TabEscrow.NotInvited.selector);
        escrow.joinBet(id);
    }

    function test_joinBet_revertsForCreatorAndArbiter() public {
        uint256 id = _mutualBet(address(0), arbiter);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.InvalidCounterparty.selector);
        escrow.joinBet(id);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.InvalidCounterparty.selector);
        escrow.joinBet(id);
    }

    function test_joinBet_joinByBoundary() public {
        uint256 id = _priceBet(opponent, true);
        vm.warp(joinBy);
        vm.prank(opponent);
        vm.expectRevert(TabEscrow.JoinClosed.selector);
        escrow.joinBet(id);
        vm.warp(joinBy - 1);
        _join(id);
    }

    function test_joinBet_revertsWhenNotOpen() public {
        uint256 id = _matchedPriceBet(true);
        vm.prank(opponent);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.joinBet(id);
        vm.prank(opponent);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.joinBet(999);
    }

    // ── cancelUnjoined ──

    function test_cancelUnjoined_beforeAndAfterJoinBy() public {
        uint256 a = _priceBet(opponent, true);
        uint256 b = _mutualBet(address(0), address(0));
        uint256 before = usdc.balanceOf(creator);

        vm.expectEmit(address(escrow));
        emit TabEscrow.BetCancelled(a);
        vm.prank(creator);
        escrow.cancelUnjoined(a);

        vm.warp(joinBy + 30 days);
        vm.prank(creator);
        escrow.cancelUnjoined(b);

        assertEq(usdc.balanceOf(creator), before + 2 * uint256(AMOUNT));
        assertEq(uint8(escrow.getBet(a).state), uint8(TabEscrow.BetState.Refunded));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_cancelUnjoined_revertsForNonCreator() public {
        uint256 id = _priceBet(opponent, true);
        vm.prank(opponent);
        vm.expectRevert(TabEscrow.NotCreator.selector);
        escrow.cancelUnjoined(id);
    }

    function test_cancelUnjoined_revertsWhenMatched() public {
        uint256 id = _matchedPriceBet(true);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.cancelUnjoined(id);
    }

    // ── settlePrice: outcomes ──

    function test_settlePrice_aboveWins() public {
        uint256 id = _matchedPriceBet(true);
        uint256 before = usdc.balanceOf(creator);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD + 1);
        vm.expectEmit(address(escrow));
        emit TabEscrow.BetSettled(id, creator, 2 * uint256(AMOUNT), THRESHOLD + 1, r);
        vm.prank(stranger);
        escrow.settlePrice(id, r);
        assertEq(usdc.balanceOf(creator), before + 2 * uint256(AMOUNT));
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Settled));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_settlePrice_tieGoesToAbove() public {
        uint256 id = _matchedPriceBet(true);
        uint256 before = usdc.balanceOf(creator);
        _settleAt(id, THRESHOLD);
        assertEq(usdc.balanceOf(creator), before + 2 * uint256(AMOUNT));
    }

    function test_settlePrice_tieLosesForBelowCreator() public {
        uint256 id = _matchedPriceBet(false);
        uint256 before = usdc.balanceOf(opponent);
        _settleAt(id, THRESHOLD);
        assertEq(usdc.balanceOf(opponent), before + 2 * uint256(AMOUNT));
    }

    function test_settlePrice_aboveLoses() public {
        uint256 id = _matchedPriceBet(true);
        uint256 before = usdc.balanceOf(opponent);
        _settleAt(id, THRESHOLD - 1);
        assertEq(usdc.balanceOf(opponent), before + 2 * uint256(AMOUNT));
    }

    function test_settlePrice_belowWins() public {
        uint256 id = _matchedPriceBet(false);
        uint256 before = usdc.balanceOf(creator);
        _settleAt(id, THRESHOLD - 1);
        assertEq(usdc.balanceOf(creator), before + 2 * uint256(AMOUNT));
    }

    /// @dev The fairness property: later price moves cannot change an outcome fixed at resolveAt.
    function test_settlePrice_lateSettlementUsesFirstRound() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt + 5 minutes);
        uint80 first = _price(THRESHOLD + 1);
        for (uint256 i; i < 10; ++i) {
            vm.warp(block.timestamp + 20 minutes);
            _price(THRESHOLD - 1000e8);
        }
        vm.warp(resolveAt + 2 days);
        uint80 latest = _price(THRESHOLD - 1000e8);

        vm.expectRevert(TabEscrow.NotFirstRound.selector);
        escrow.settlePrice(id, latest);

        uint256 before = usdc.balanceOf(creator);
        escrow.settlePrice(id, first);
        assertEq(usdc.balanceOf(creator), before + 2 * uint256(AMOUNT));
    }

    function test_settlePrice_acrossPhaseBoundary() public {
        uint256 id = _matchedPriceBet(true);
        ethFeed.newPhase();
        vm.warp(resolveAt - 1);
        uint80 phaseStart = _price(THRESHOLD - 1);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        assertEq(r >> 64, 2);
        assertEq(r, phaseStart + 1);
        escrow.settlePrice(id, r);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Settled));
    }

    // ── settlePrice: guards ──

    function test_settlePrice_revertsBeforeResolveAt() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt - 1);
        uint80 r = _price(THRESHOLD);
        vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_revertsOnWrongKind() public {
        uint256 id = _matchedMutualBet(address(0));
        vm.expectRevert(TabEscrow.WrongKind.selector);
        escrow.settlePrice(id, 0);
    }

    function test_settlePrice_revertsWhenOpen() public {
        uint256 id = _priceBet(opponent, true);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_revertsWhenSequencerDown() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        sequencer.set(1, block.timestamp - 10 hours, block.timestamp - 10 hours);
        vm.expectRevert(TabEscrow.SequencerDown.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_sequencerGraceBoundary() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        sequencer.set(0, block.timestamp, block.timestamp);
        vm.warp(block.timestamp + escrow.SEQUENCER_GRACE_PERIOD());
        vm.expectRevert(TabEscrow.SequencerDown.selector);
        escrow.settlePrice(id, r);

        vm.warp(block.timestamp + 1);
        escrow.settlePrice(id, r);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Settled));
    }

    function test_settlePrice_revertsOnUninitialisedSequencerRound() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        sequencer.set(0, 0, 0);
        vm.expectRevert(TabEscrow.SequencerDown.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_revertsOnNonPositiveAnswer() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 negative = _price(-1);
        uint80 zero = _price(0);
        vm.expectRevert(TabEscrow.InvalidPrice.selector);
        escrow.settlePrice(id, negative);
        vm.expectRevert(TabEscrow.InvalidPrice.selector);
        escrow.settlePrice(id, zero);
    }

    function test_settlePrice_revertsOnFutureUpdatedAt() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 r = ethFeed.set(THRESHOLD, block.timestamp, block.timestamp + 1);
        vm.expectRevert(TabEscrow.InvalidPrice.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_revertsWhenNoRoundSinceResolveAt() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt - 1);
        uint80 r = _price(THRESHOLD);
        vm.warp(resolveAt + 10 minutes);
        vm.expectRevert(TabEscrow.PriceNotFinal.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_revertsOnRoundBeforeResolveAt() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt - 1);
        uint80 early = _price(THRESHOLD);
        vm.warp(resolveAt);
        _price(THRESHOLD);
        vm.expectRevert(TabEscrow.PriceNotFinal.selector);
        escrow.settlePrice(id, early);
    }

    function test_settlePrice_revertsWhenPredecessorAlsoAfterResolveAt() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        _price(THRESHOLD);
        vm.warp(resolveAt + 1);
        uint80 second = _price(THRESHOLD - 1);
        vm.expectRevert(TabEscrow.NotFirstRound.selector);
        escrow.settlePrice(id, second);
    }

    function test_settlePrice_revertsOnRoundFromSupersededPhase() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 oldPhaseRound = _price(THRESHOLD);
        ethFeed.newPhase();
        vm.expectRevert(TabEscrow.RoundNotProvable.selector);
        escrow.settlePrice(id, oldPhaseRound);
    }

    function test_settlePrice_revertsWhenPhaseUnreadable() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        ethFeed.setRevertOnPhaseId(true);
        vm.expectRevert(TabEscrow.RoundNotProvable.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_revertsOnFirstRoundOfPhase() public {
        uint256 id = _matchedPriceBet(true);
        ethFeed.newPhase();
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        assertEq(uint64(r), 1);
        vm.expectRevert(TabEscrow.RoundNotProvable.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_revertsOnMissingRound() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        _price(THRESHOLD);
        uint80 missing = ethFeed.latestRound() + 100;
        vm.expectRevert(TabEscrow.RoundNotProvable.selector);
        escrow.settlePrice(id, missing);

        ethFeed.setRevertOnMissing(true);
        vm.expectRevert(TabEscrow.RoundNotProvable.selector);
        escrow.settlePrice(id, missing);
    }

    function test_settlePrice_revertsOnRoundIdZero() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        ethFeed.setRevertOnMissing(false);
        vm.expectRevert(TabEscrow.RoundNotProvable.selector);
        escrow.settlePrice(id, 0);
    }

    function test_settlePrice_revertsWhenFirstRoundTooLate() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt + STALENESS + 1);
        uint80 r = _price(THRESHOLD);
        vm.expectRevert(TabEscrow.StalePrice.selector);
        escrow.settlePrice(id, r);
    }

    function test_settlePrice_acceptsFirstRoundAtStalenessLimit() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt + STALENESS);
        uint80 r = _price(THRESHOLD);
        vm.warp(resolveAt + 2 days);
        escrow.settlePrice(id, r);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Settled));
    }

    function test_settlePrice_revertsWhenAlreadySettled() public {
        uint256 id = _matchedPriceBet(true);
        uint80 r = _settleAt(id, THRESHOLD);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.settlePrice(id, r);
    }

    // ── refundStale ──

    function test_refundStale_priceBoundary() public {
        uint256 id = _matchedPriceBet(true);
        uint256 unlock = uint256(resolveAt) + escrow.PRICE_REFUND_DELAY();
        vm.warp(unlock - 1);
        vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.refundStale(id);

        vm.warp(unlock);
        uint256 c = usdc.balanceOf(creator);
        uint256 o = usdc.balanceOf(opponent);
        vm.expectEmit(address(escrow));
        emit TabEscrow.BetRefunded(id);
        vm.prank(stranger);
        escrow.refundStale(id);
        assertEq(usdc.balanceOf(creator), c + AMOUNT);
        assertEq(usdc.balanceOf(opponent), o + AMOUNT);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Refunded));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refundStale_mutualBoundary() public {
        uint256 id = _matchedMutualBet(address(0));
        uint256 unlock = uint256(resolveAt) + escrow.MUTUAL_REFUND_DELAY();
        vm.warp(unlock - 1);
        vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.refundStale(id);
        vm.warp(unlock);
        escrow.refundStale(id);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Refunded));
    }

    function test_refundStale_loneReportDoesNotAutoWin() public {
        uint256 id = _matchedMutualBet(address(0));
        vm.warp(resolveAt);
        vm.prank(creator);
        escrow.report(id, creator);
        vm.warp(uint256(resolveAt) + escrow.MUTUAL_REFUND_DELAY());
        uint256 c = usdc.balanceOf(creator);
        escrow.refundStale(id);
        assertEq(usdc.balanceOf(creator), c + AMOUNT);
    }

    function test_refundStale_revertsWhenNotMatched() public {
        uint256 id = _priceBet(opponent, true);
        vm.warp(resolveAt + 30 days);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.refundStale(id);
    }

    function test_refundStale_sequencerDownFallback() public {
        uint256 id = _matchedPriceBet(true);
        vm.warp(resolveAt);
        uint80 r = _price(THRESHOLD);
        sequencer.set(1, block.timestamp, block.timestamp);
        vm.expectRevert(TabEscrow.SequencerDown.selector);
        escrow.settlePrice(id, r);
        vm.warp(uint256(resolveAt) + escrow.PRICE_REFUND_DELAY());
        escrow.refundStale(id);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ── report ──

    function test_report_matchingReportsPayWinner() public {
        uint256 id = _matchedMutualBet(address(0));
        vm.warp(resolveAt);
        vm.expectEmit(address(escrow));
        emit TabEscrow.BetReported(id, creator, opponent);
        vm.prank(creator);
        escrow.report(id, opponent);
        assertEq(escrow.getBet(id).creatorReport, opponent);

        uint256 before = usdc.balanceOf(opponent);
        vm.expectEmit(address(escrow));
        emit TabEscrow.BetSettled(id, opponent, 2 * uint256(AMOUNT), 0, 0);
        vm.prank(opponent);
        escrow.report(id, opponent);
        assertEq(usdc.balanceOf(opponent), before + 2 * uint256(AMOUNT));
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Settled));
    }

    function test_report_conflictThenConcede() public {
        uint256 id = _matchedMutualBet(address(0));
        vm.warp(resolveAt);
        vm.prank(creator);
        escrow.report(id, creator);
        vm.prank(opponent);
        escrow.report(id, opponent);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Matched));

        uint256 before = usdc.balanceOf(creator);
        vm.prank(opponent);
        escrow.report(id, creator);
        assertEq(usdc.balanceOf(creator), before + 2 * uint256(AMOUNT));
    }

    function test_report_revertsBeforeResolveAt() public {
        uint256 id = _matchedMutualBet(address(0));
        vm.warp(resolveAt - 1);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.TooEarly.selector);
        escrow.report(id, creator);
    }

    function test_report_revertsOnWrongKind() public {
        uint256 id = _matchedPriceBet(true);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.WrongKind.selector);
        escrow.report(id, creator);
    }

    function test_report_revertsWhenOpen() public {
        uint256 id = _mutualBet(opponent, address(0));
        vm.warp(resolveAt);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.report(id, creator);
    }

    function test_report_revertsOnInvalidWinner() public {
        uint256 id = _matchedMutualBet(address(0));
        vm.warp(resolveAt);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.InvalidWinner.selector);
        escrow.report(id, stranger);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.InvalidWinner.selector);
        escrow.report(id, address(0));
    }

    function test_report_revertsForNonParty() public {
        uint256 id = _matchedMutualBet(arbiter);
        vm.warp(resolveAt);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.NotParty.selector);
        escrow.report(id, creator);
    }

    // ── arbitrate ──

    function test_arbitrate_onConflict() public {
        uint256 id = _matchedMutualBet(arbiter);
        vm.warp(resolveAt);
        vm.prank(creator);
        escrow.report(id, creator);
        vm.prank(opponent);
        escrow.report(id, opponent);

        uint256 before = usdc.balanceOf(opponent);
        vm.expectEmit(address(escrow));
        emit TabEscrow.BetSettled(id, opponent, 2 * uint256(AMOUNT), 0, 0);
        vm.prank(arbiter);
        escrow.arbitrate(id, opponent);
        assertEq(usdc.balanceOf(opponent), before + 2 * uint256(AMOUNT));
    }

    function test_arbitrate_missingReportGraceBoundary() public {
        uint256 id = _matchedMutualBet(arbiter);
        vm.warp(resolveAt);
        vm.prank(creator);
        escrow.report(id, creator);

        uint256 unlock = uint256(resolveAt) + escrow.ARBITRATION_GRACE();
        vm.warp(unlock - 1);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.ArbitrationNotAllowed.selector);
        escrow.arbitrate(id, creator);

        vm.warp(unlock);
        vm.prank(arbiter);
        escrow.arbitrate(id, creator);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Settled));
    }

    function test_arbitrate_revertsOnWrongKind() public {
        uint256 id = _matchedPriceBet(true);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.WrongKind.selector);
        escrow.arbitrate(id, creator);
    }

    function test_arbitrate_revertsForNonArbiter() public {
        uint256 withArb = _matchedMutualBet(arbiter);
        vm.warp(resolveAt + 3 days);
        vm.prank(creator);
        vm.expectRevert(TabEscrow.NotArbiter.selector);
        escrow.arbitrate(withArb, creator);
    }

    function test_arbitrate_revertsWhenNoArbiter() public {
        uint256 id = _matchedMutualBet(address(0));
        vm.warp(resolveAt + 3 days);
        vm.prank(address(0));
        vm.expectRevert(TabEscrow.NotArbiter.selector);
        escrow.arbitrate(id, creator);
    }

    function test_arbitrate_revertsWhenNotMatched() public {
        uint256 id = _mutualBet(opponent, arbiter);
        vm.warp(resolveAt + 3 days);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.InvalidState.selector);
        escrow.arbitrate(id, creator);
    }

    function test_arbitrate_revertsOnInvalidWinner() public {
        uint256 id = _matchedMutualBet(arbiter);
        vm.warp(resolveAt + 3 days);
        vm.prank(arbiter);
        vm.expectRevert(TabEscrow.InvalidWinner.selector);
        escrow.arbitrate(id, arbiter);
    }
}
