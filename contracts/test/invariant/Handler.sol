// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TabEscrow} from "../../src/TabEscrow.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";

/// @dev Drives TabEscrow through random sequences of valid-ish actions by 4 actors. Calls that revert are
///      allowed (fail_on_revert = false); inputs are bounded so most calls hit real state transitions.
contract Handler is Test {
    TabEscrow internal immutable escrow;
    MockUSDC internal immutable usdc;
    MockAggregator internal immutable feed;
    address[4] internal actors;

    mapping(bytes32 action => uint256) public calls;

    constructor(TabEscrow escrow_, MockUSDC usdc_, MockAggregator feed_, address[4] memory actors_) {
        escrow = escrow_;
        usdc = usdc_;
        feed = feed_;
        actors = actors_;
        for (uint256 i; i < 4; ++i) {
            usdc.mint(actors[i], 1e18);
            vm.prank(actors[i]);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 4];
    }

    function _other(uint256 seed, uint256 offset) internal view returns (address) {
        return actors[(seed + 1 + offset % 3) % 4];
    }

    function _dealId(uint256 seed) internal view returns (uint256) {
        uint256 n = escrow.nextDealId();
        return n == 1 ? 1 : bound(seed, 1, n - 1);
    }

    function _betId(uint256 seed) internal view returns (uint256) {
        uint256 n = escrow.nextBetId();
        return n == 1 ? 1 : bound(seed, 1, n - 1);
    }

    // ── deals ──

    function createDeal(uint256 a, uint256 s, uint128 amount, uint64 horizon, uint64 review, bool withArb) external {
        address buyer = _actor(a);
        address seller = _other(a, s);
        address arb = withArb ? _other(a, s + 1) : address(0);
        if (arb == seller) arb = address(0);
        vm.prank(buyer);
        escrow.createDeal(
            seller,
            uint128(bound(amount, 1, 1e12)),
            uint64(block.timestamp + bound(horizon, 1, 30 days)),
            uint64(bound(review, 1 minutes, 30 days)),
            arb,
            bytes32(0)
        );
        ++calls["createDeal"];
    }

    function markDelivered(uint256 seed) external {
        uint256 id = _dealId(seed);
        vm.prank(escrow.getDeal(id).seller);
        escrow.markDelivered(id);
        ++calls["markDelivered"];
    }

    function release(uint256 seed) external {
        uint256 id = _dealId(seed);
        vm.prank(escrow.getDeal(id).buyer);
        escrow.release(id);
        ++calls["release"];
    }

    function claim(uint256 seed) external {
        uint256 id = _dealId(seed);
        vm.prank(escrow.getDeal(id).seller);
        escrow.claim(id);
        ++calls["claim"];
    }

    function refund(uint256 seed, bool asSeller) external {
        uint256 id = _dealId(seed);
        TabEscrow.Deal memory d = escrow.getDeal(id);
        vm.prank(asSeller ? d.seller : d.buyer);
        escrow.refund(id);
        ++calls["refund"];
    }

    function cancelBySeller(uint256 seed) external {
        uint256 id = _dealId(seed);
        vm.prank(escrow.getDeal(id).seller);
        escrow.cancelBySeller(id);
        ++calls["cancelBySeller"];
    }

    function dispute(uint256 seed, bool asSeller) external {
        uint256 id = _dealId(seed);
        TabEscrow.Deal memory d = escrow.getDeal(id);
        vm.prank(asSeller ? d.seller : d.buyer);
        escrow.dispute(id);
        ++calls["dispute"];
    }

    function resolve(uint256 seed, uint16 bps) external {
        uint256 id = _dealId(seed);
        vm.prank(escrow.getDeal(id).arbiter);
        escrow.resolve(id, uint16(bound(bps, 0, 10_000)));
        ++calls["resolve"];
    }

    // ── bets ──

    function createPriceBet(
        uint256 a,
        uint256 o,
        uint128 stake,
        uint64 join,
        uint64 resolveDelay,
        bool open,
        bool above
    ) external {
        uint64 joinBy = uint64(block.timestamp + bound(join, 1, 7 days));
        vm.prank(_actor(a));
        escrow.createPriceBet(
            open ? address(0) : _other(a, o),
            uint128(bound(stake, 1, 1e12)),
            joinBy,
            joinBy + uint64(bound(resolveDelay, 10 minutes, 7 days)),
            address(feed),
            3000e8,
            above,
            bytes32(0)
        );
        ++calls["createPriceBet"];
    }

    function createMutualBet(uint256 a, uint256 o, uint128 stake, uint64 join, uint64 resolveDelay, bool withArb)
        external
    {
        address opp = _other(a, o);
        address arb = withArb ? _other(a, o + 1) : address(0);
        if (arb == opp) arb = address(0);
        uint64 joinBy = uint64(block.timestamp + bound(join, 1, 7 days));
        vm.prank(_actor(a));
        escrow.createMutualBet(
            opp,
            uint128(bound(stake, 1, 1e12)),
            joinBy,
            joinBy + uint64(bound(resolveDelay, 10 minutes, 7 days)),
            arb,
            bytes32(0)
        );
        ++calls["createMutualBet"];
    }

    function joinBet(uint256 seed, uint256 who) external {
        uint256 id = _betId(seed);
        TabEscrow.Bet memory b = escrow.getBet(id);
        vm.prank(b.opponent == address(0) ? _other(uint256(uint160(b.creator)), who) : b.opponent);
        escrow.joinBet(id);
        ++calls["joinBet"];
    }

    function cancelUnjoined(uint256 seed) external {
        uint256 id = _betId(seed);
        vm.prank(escrow.getBet(id).creator);
        escrow.cancelUnjoined(id);
        ++calls["cancelUnjoined"];
    }

    /// @dev Publishes a round at (or right after) resolveAt when one is still in time, so settlements succeed.
    function settlePrice(uint256 seed, int256 p) external {
        uint256 id = _betId(seed);
        uint64 resolveAt = escrow.getBet(id).resolveAt;
        if (block.timestamp < resolveAt) vm.warp(resolveAt);
        if (block.timestamp <= uint256(resolveAt) + 1 hours) {
            feed.set(bound(p, 2000e8, 4000e8), block.timestamp, block.timestamp);
        }
        escrow.settlePrice(id, _firstRoundAtOrAfter(resolveAt));
        ++calls["settlePrice"];
    }

    function report(uint256 seed, bool asCreator, bool creatorWins) external {
        uint256 id = _betId(seed);
        TabEscrow.Bet memory b = escrow.getBet(id);
        vm.prank(asCreator ? b.creator : b.opponent);
        escrow.report(id, creatorWins ? b.creator : b.opponent);
        ++calls["report"];
    }

    function arbitrate(uint256 seed, bool creatorWins) external {
        uint256 id = _betId(seed);
        TabEscrow.Bet memory b = escrow.getBet(id);
        vm.prank(b.arbiter);
        escrow.arbitrate(id, creatorWins ? b.creator : b.opponent);
        ++calls["arbitrate"];
    }

    function refundStale(uint256 seed) external {
        escrow.refundStale(_betId(seed));
        ++calls["refundStale"];
    }

    /// @dev Mirrors shared/findSettlementRound.ts against the mock: walk back from the latest round.
    function _firstRoundAtOrAfter(uint64 resolveAt) internal view returns (uint80 roundId) {
        roundId = feed.latestRound();
        (,,, uint256 updatedAt,) = feed.getRoundData(roundId);
        if (updatedAt < resolveAt) return roundId;
        for (uint256 i; i < 200 && uint64(roundId) > 1; ++i) {
            (,,, uint256 prevUpdatedAt,) = feed.getRoundData(roundId - 1);
            if (prevUpdatedAt < resolveAt) break;
            --roundId;
        }
    }

    function withdraw(uint256 a) external {
        vm.prank(_actor(a));
        escrow.withdraw();
        ++calls["withdraw"];
    }

    // ── environment ──

    /// @dev Simulates a USDC blacklist toggle so payouts exercise the `owed` fallback.
    function toggleBlocked(uint256 a) external {
        address actor = _actor(a);
        usdc.setBlocked(actor, !usdc.blocked(actor));
    }

    function actor(uint256 i) external view returns (address) {
        return actors[i];
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 10 days));
    }

    function pushPrice(int256 p) external {
        feed.set(bound(p, 2000e8, 4000e8), block.timestamp, block.timestamp);
    }
}
