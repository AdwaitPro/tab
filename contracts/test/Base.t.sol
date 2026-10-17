// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TabEscrow} from "../src/TabEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

abstract contract BaseTest is Test {
    uint256 internal constant T0 = 1_800_000_000;
    uint32 internal constant STALENESS = 3600;
    uint128 internal constant AMOUNT = 25e6;
    uint64 internal constant REVIEW = 1 days;
    int256 internal constant THRESHOLD = 3000e8;
    bytes32 internal constant TERMS = keccak256("terms");

    TabEscrow internal escrow;
    MockUSDC internal usdc;
    MockAggregator internal ethFeed;
    MockAggregator internal sequencer;

    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        ethFeed = new MockAggregator(8);
        sequencer = new MockAggregator(0);
        sequencer.set(0, T0 - 1 days, T0 - 1 days);
        ethFeed.set(THRESHOLD, T0, T0);

        address[] memory feeds = new address[](1);
        feeds[0] = address(ethFeed);
        uint32[] memory staleness = new uint32[](1);
        staleness[0] = STALENESS;
        escrow = new TabEscrow(IERC20(address(usdc)), address(sequencer), feeds, staleness);

        address[4] memory users = [buyer, seller, arbiter, stranger];
        for (uint256 i; i < users.length; ++i) {
            usdc.mint(users[i], 1e15);
            vm.prank(users[i]);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    /// @dev Pushes a fresh price at the current timestamp.
    function _price(int256 p) internal returns (uint80 roundId) {
        roundId = ethFeed.set(p, block.timestamp, block.timestamp);
    }

    function _createDeal(address arb) internal returns (uint256 id) {
        vm.prank(buyer);
        id = escrow.createDeal(seller, AMOUNT, uint64(block.timestamp + 7 days), REVIEW, arb, TERMS);
    }
}
