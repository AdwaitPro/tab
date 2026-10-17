// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Base mainnet addresses, verified on-chain (see CONSTANTS.md). Shared by the deploy script and fork test.
library BaseMainnet {
    uint256 internal constant CHAIN_ID = 8453;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant SEQUENCER_UPTIME_FEED = 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433;
    address internal constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address internal constant BTC_USD_FEED = 0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F;
    uint8 internal constant FEED_DECIMALS = 8;
    /// @dev 3 × the 1200 s heartbeat of both feeds on Base.
    uint32 internal constant ETH_USD_MAX_STALENESS = 3600;
    uint32 internal constant BTC_USD_MAX_STALENESS = 3600;

    function priceFeeds() internal pure returns (address[] memory feeds, uint32[] memory staleness) {
        feeds = new address[](2);
        staleness = new uint32[](2);
        (feeds[0], staleness[0]) = (ETH_USD_FEED, ETH_USD_MAX_STALENESS);
        (feeds[1], staleness[1]) = (BTC_USD_FEED, BTC_USD_MAX_STALENESS);
    }
}
