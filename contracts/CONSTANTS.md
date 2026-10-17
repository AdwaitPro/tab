# Base mainnet constants (verified on-chain)

Verified 2026-10-18 with `cast` against `https://mainnet.base.org` (chainId 8453, block 52737349,
`block.timestamp` ≈ 1792264027).

| Name | Address | Check | Result |
|---|---|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `symbol()`, `decimals()` | `USDC`, `6` |
| Chainlink ETH/USD proxy | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | `description()`, `decimals()`, `latestRoundData()` | `ETH / USD`, `8`, answer `241448000000` ($2,414.48), updatedAt 1792263547 (≈8 min old) |
| Chainlink BTC/USD proxy | `0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F` | same | `BTC / USD`, `8`, answer `8139975975457` ($81,399.76), updatedAt 1792263901 (≈2 min old) |
| Chainlink L2 Sequencer Uptime Feed | `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433` | `description()`, `latestRoundData()` | `L2 Sequencer Uptime Status Feed`, answer `0` (up), startedAt 1782491507 (up for ≈113 days) |

## maxStaleness

Both price feeds on Base publish on a 1200 s (20 min) heartbeat or on deviation, whichever comes first.
`maxStaleness = 3600` s (3 × heartbeat) for each: tolerant of a delayed round, but a feed that has stopped
updating for an hour is treated as broken (`StalePrice`), and the 3-day `refundStale` fallback applies.

## Re-verify

```sh
R=https://mainnet.base.org   # fallback: https://base-rpc.publicnode.com
for a in 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70 0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433; do
  cast call $a 'description()(string)' --rpc-url $R
  cast call $a 'decimals()(uint8)' --rpc-url $R
  cast call $a 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url $R
done
```
