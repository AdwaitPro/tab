// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TabEscrow} from "../../src/TabEscrow.sol";
import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";
import {BaseMainnet} from "../../script/BaseMainnet.sol";

/// @notice End-to-end against Base mainnet state: real USDC, real Chainlink ETH/USD and sequencer feed.
/// @dev Runs when the suite is pointed at Base (`forge test --fork-url https://mainnet.base.org`) or when
///      BASE_RPC_URL is set; skipped otherwise. The price bet is opened ~1h in the past (at an older block)
///      and settled at the latest block so the real feed has genuinely updated after `resolveAt`.
contract TabEscrowForkTest is Test {
    uint256 internal constant LOOKBACK_BLOCKS = 1_800; // 2 s blocks → 1 hour
    uint128 internal constant AMOUNT = 5e6;

    IERC20 internal usdc = IERC20(BaseMainnet.USDC);
    address internal buyer = makeAddr("fork-buyer");
    address internal seller = makeAddr("fork-seller");
    TabEscrow internal escrow;
    uint256 internal latestBlock;

    function setUp() public {
        if (block.chainid != BaseMainnet.CHAIN_ID) {
            string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
            if (bytes(rpc).length == 0) {
                vm.skip(true);
                return;
            }
            vm.createSelectFork(rpc);
        }
        latestBlock = block.number;
        vm.rollFork(latestBlock - LOOKBACK_BLOCKS);

        (address[] memory feeds, uint32[] memory staleness) = BaseMainnet.priceFeeds();
        escrow = new TabEscrow(usdc, BaseMainnet.SEQUENCER_UPTIME_FEED, feeds, staleness);
        vm.makePersistent(address(escrow));

        deal(address(usdc), buyer, 100e6);
        deal(address(usdc), seller, 100e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(seller);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function test_fork_constantsMatchChain() public view {
        AggregatorV3Interface eth = AggregatorV3Interface(BaseMainnet.ETH_USD_FEED);
        AggregatorV3Interface btc = AggregatorV3Interface(BaseMainnet.BTC_USD_FEED);
        assertEq(eth.description(), "ETH / USD");
        assertEq(btc.description(), "BTC / USD");
        assertEq(eth.decimals(), 8);
        // settlePrice pins rounds to the proxy's current phase; the real proxies must expose it consistently.
        (uint80 ethRound,,,,) = eth.latestRoundData();
        (uint80 btcRound,,,,) = btc.latestRoundData();
        assertEq(uint16(ethRound >> 64), eth.phaseId());
        assertEq(uint16(btcRound >> 64), btc.phaseId());
        assertEq(btc.decimals(), 8);
        (, int256 status,,,) = AggregatorV3Interface(BaseMainnet.SEQUENCER_UPTIME_FEED).latestRoundData();
        assertEq(status, 0);
        assertEq(escrow.maxStaleness(BaseMainnet.ETH_USD_FEED), BaseMainnet.ETH_USD_MAX_STALENESS);
        assertEq(escrow.maxStaleness(BaseMainnet.BTC_USD_FEED), BaseMainnet.BTC_USD_MAX_STALENESS);
    }

    function test_fork_fullDeal() public {
        vm.prank(buyer);
        uint256 id = escrow.createDeal(seller, AMOUNT, uint64(block.timestamp + 1 days), 1 hours, address(0), "");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);

        vm.prank(seller);
        escrow.markDelivered(id);
        vm.warp(block.timestamp + 1 hours);
        uint256 before = usdc.balanceOf(seller);
        vm.prank(seller);
        escrow.claim(id);

        assertEq(usdc.balanceOf(seller), before + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_fork_fullPriceBet() public {
        (, int256 openPrice,,,) = AggregatorV3Interface(BaseMainnet.ETH_USD_FEED).latestRoundData();
        uint64 joinBy = uint64(block.timestamp + 60);
        uint64 resolveAt = joinBy + uint64(escrow.MIN_JOIN_GAP());
        vm.prank(buyer);
        // Threshold far below spot so the outcome is deterministic: creator ("above") must win.
        uint256 id =
            escrow.createPriceBet(seller, AMOUNT, joinBy, resolveAt, BaseMainnet.ETH_USD_FEED, openPrice / 2, true, "");
        vm.prank(seller);
        escrow.joinBet(id);
        assertEq(usdc.balanceOf(address(escrow)), 2 * uint256(AMOUNT));

        // Carry the escrow's USDC balance across the roll; only the feeds are read from the newer block.
        vm.makePersistent(address(usdc));
        vm.rollFork(latestBlock);
        (,,, uint256 updatedAt,) = AggregatorV3Interface(BaseMainnet.ETH_USD_FEED).latestRoundData();
        assertGe(updatedAt, resolveAt, "feed has not updated within the lookback window");

        AggregatorV3Interface feed = AggregatorV3Interface(BaseMainnet.ETH_USD_FEED);
        uint80 first = _firstRoundAtOrAfter(feed, resolveAt);
        (,,, uint256 firstAt,) = feed.getRoundData(first);
        (,,, uint256 prevAt,) = feed.getRoundData(first - 1);
        assertGe(firstAt, resolveAt);
        assertLt(prevAt, resolveAt);

        vm.expectRevert(TabEscrow.PriceNotFinal.selector);
        escrow.settlePrice(id, first - 1);
        (uint80 latestRound,,,,) = feed.latestRoundData();
        if (latestRound != first) {
            vm.expectRevert(TabEscrow.NotFirstRound.selector);
            escrow.settlePrice(id, latestRound);
        }

        uint256 before = usdc.balanceOf(buyer);
        escrow.settlePrice(id, first);
        assertEq(usdc.balanceOf(buyer), before + 2 * uint256(AMOUNT));
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getBet(id).state), uint8(TabEscrow.BetState.Settled));
    }

    /// @dev Same walk as shared/findSettlementRound.ts, against the real proxy.
    function _firstRoundAtOrAfter(AggregatorV3Interface feed, uint64 resolveAt) internal view returns (uint80 r) {
        (r,,,,) = feed.latestRoundData();
        for (uint256 i; i < 200; ++i) {
            (,,, uint256 prevAt,) = feed.getRoundData(r - 1);
            if (prevAt < resolveAt) return r;
            --r;
        }
        revert("no round within 200 steps");
    }
}
