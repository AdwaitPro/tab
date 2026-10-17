// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TabEscrow} from "../src/TabEscrow.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {BaseMainnet} from "./BaseMainnet.sol";

/// @notice Deploys TabEscrow to Base mainnet with the verified constants and writes deployments/base.json.
/// @dev Reads PRIVATE_KEY from the environment. `block` in the output is the pre-broadcast block number,
///      a safe lower bound for indexers; `txHash` is filled in from the broadcast receipt (see README).
contract Deploy is Script {
    string internal constant OUT = "../deployments/base.json";

    function run() external returns (TabEscrow escrow) {
        require(block.chainid == BaseMainnet.CHAIN_ID, "Deploy: not Base mainnet");
        _assertFeed(BaseMainnet.ETH_USD_FEED, "ETH / USD");
        _assertFeed(BaseMainnet.BTC_USD_FEED, "BTC / USD");
        (, int256 status,,,) = AggregatorV3Interface(BaseMainnet.SEQUENCER_UPTIME_FEED).latestRoundData();
        require(status == 0, "Deploy: sequencer feed reports down");

        (address[] memory feeds, uint32[] memory staleness) = BaseMainnet.priceFeeds();
        uint256 startBlock = block.number;

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        escrow = new TabEscrow(IERC20(BaseMainnet.USDC), BaseMainnet.SEQUENCER_UPTIME_FEED, feeds, staleness);
        vm.stopBroadcast();

        console2.log("TabEscrow deployed at", address(escrow));
        // A dry run must not overwrite the shared deployment record with a simulated address.
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _write(address(escrow), startBlock);
        } else {
            console2.log("Dry run: deployments/base.json not written");
        }
    }

    function _assertFeed(address feed, string memory expected) internal view {
        AggregatorV3Interface agg = AggregatorV3Interface(feed);
        require(keccak256(bytes(agg.description())) == keccak256(bytes(expected)), "Deploy: wrong feed");
        require(agg.decimals() == BaseMainnet.FEED_DECIMALS, "Deploy: wrong feed decimals");
    }

    function _feedJson(string memory key, address feed, uint32 staleness) internal returns (string memory) {
        vm.serializeAddress(key, "address", feed);
        vm.serializeUint(key, "decimals", BaseMainnet.FEED_DECIMALS);
        return vm.serializeUint(key, "maxStaleness", staleness);
    }

    function _write(address escrow, uint256 startBlock) internal {
        vm.serializeString(
            "feeds", "ETH", _feedJson("eth", BaseMainnet.ETH_USD_FEED, BaseMainnet.ETH_USD_MAX_STALENESS)
        );
        string memory feedsJson = vm.serializeString(
            "feeds", "BTC", _feedJson("btc", BaseMainnet.BTC_USD_FEED, BaseMainnet.BTC_USD_MAX_STALENESS)
        );

        string memory root = "root";
        vm.serializeAddress(root, "address", escrow);
        vm.serializeString(root, "txHash", "");
        vm.serializeUint(root, "block", startBlock);
        vm.serializeUint(root, "chainId", BaseMainnet.CHAIN_ID);
        vm.serializeAddress(root, "usdc", BaseMainnet.USDC);
        vm.serializeAddress(root, "sequencerFeed", BaseMainnet.SEQUENCER_UPTIME_FEED);
        string memory json = vm.serializeString(root, "feeds", feedsJson);
        vm.writeJson(json, OUT);
    }
}
