// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {BaseTest} from "../Base.t.sol";
import {TabEscrow} from "../../src/TabEscrow.sol";
import {Handler} from "./Handler.sol";

contract TabEscrowInvariantTest is StdInvariant, BaseTest {
    Handler internal handler;

    function setUp() public override {
        // Mock-only suite. Under --fork-url the inherited mainnet gas price makes the unfunded fuzz senders fail
        // tx validation, and forking adds nothing here; the fork suite covers real-chain behaviour.
        if (block.chainid != 31337) {
            vm.skip(true);
            return;
        }
        super.setUp();
        address[4] memory actors = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2"), makeAddr("a3")];
        handler = new Handler(escrow, usdc, ethFeed, actors);
        targetContract(address(handler));
    }

    /// @dev The escrow holds exactly what is still locked plus what is owed to failed-payout recipients.
    function invariant_balanceEqualsLocked() public view {
        uint256 locked;
        for (uint256 id = 1; id < escrow.nextDealId(); ++id) {
            TabEscrow.Deal memory d = escrow.getDeal(id);
            if (
                d.state == TabEscrow.DealState.Funded || d.state == TabEscrow.DealState.Delivered
                    || d.state == TabEscrow.DealState.Disputed
            ) locked += d.amount;
        }
        for (uint256 id = 1; id < escrow.nextBetId(); ++id) {
            TabEscrow.Bet memory b = escrow.getBet(id);
            if (b.state == TabEscrow.BetState.Open) locked += b.stake;
            else if (b.state == TabEscrow.BetState.Matched) locked += 2 * uint256(b.stake);
        }
        uint256 owed;
        for (uint256 i; i < 4; ++i) {
            owed += escrow.owed(handler.actor(i));
        }
        assertEq(usdc.balanceOf(address(escrow)), locked + owed);
    }
}
