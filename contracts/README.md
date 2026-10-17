# TabEscrow contracts

Ownerless USDC escrow for Tab **Deals** (buyer → seller, optional arbiter) and **Bets** (Chainlink price bets and
mutually-reported event bets) on Base mainnet. Spec: `docs/PRD.md` §9. Threat review: `SECURITY.md`. Verified
addresses: `CONSTANTS.md`.

## ABI deviations from PRD

All function names and argument lists match PRD §9.2/§9.3 exactly. Additions and event details the PRD left open:

- **Views/config added:** `getDeal(id)`, `getBet(id)` (return the full structs in PRD field order), `nextDealId()`,
  `nextBetId()` (ids start at **1**; 0 is never valid), `token()`, `sequencerUptimeFeed()`, `maxStaleness(feed)`
  (0 = feed not allowlisted), and the timing constants `DISPUTE_TIMEOUT` (30 d), `SEQUENCER_GRACE_PERIOD` (1 h),
  `PRICE_REFUND_DELAY` (3 d), `MUTUAL_REFUND_DELAY` (7 d), `ARBITRATION_GRACE` (2 d), `MIN/MAX_REVIEW_WINDOW`, `BPS`.
- **v2 (security audit) changes:**
  - `Deal` gains a trailing field **`uint64 disputedAt`** (after `termsHash`; `getDeal` tuple grows by one).
  - **`dispute`** is only allowed while Funded and `now < deliverBy`, or Delivered and
    `now < deliveredAt + reviewWindow`; otherwise `TooLate`. The arbiter-timeout `refund` of a Disputed deal
    opens at **`disputedAt + DISPUTE_TIMEOUT`** (30 d), no longer `deliverBy + reviewWindow + 30 d`. The arbiter
    may `resolve` at any time while Disputed.
  - **Pull-payment fallback:** every payout first tries a direct transfer; if it fails (USDC blacklist, false
    return) the amount is credited to **`owed(address)`** and `PayoutDeferred(to, amount)` is emitted. The
    recipient claims with **`withdraw()`** (`Withdrawn(to, amount)`, `NothingOwed` if zero). Happy path is still
    one click; UIs should show a "Withdraw" button when `owed(user) > 0`.
  - **`MIN_JOIN_GAP()`** = 10 minutes: bets require `resolveAt ≥ joinBy + MIN_JOIN_GAP`, else `InvalidDeadline`.
  - **Phase pinning:** `settlePrice` requires `roundId >> 64 == feed.phaseId()` (the proxy's current phase),
    else `RoundNotProvable`.
- **`DealRefunded(id, amount, byDeadline)`** is emitted by both `refund` (`byDeadline = true`) and
  `cancelBySeller` (`false`); there is no separate cancel event.
- **`claim` ends in state `Released`** (same as `release`), distinguished by the `DealClaimed` event.
- **`settlePrice(uint256 id, uint80 roundId)`** (PRD had `settlePrice(id)`): settles at the **first** Chainlink
  round at/after `resolveAt`, proven on-chain (see SECURITY.md #6a). Find `roundId` with
  `shared/findSettlementRound.ts`. Revert meanings: `PriceNotFinal` = no round at/after `resolveAt` yet (or the
  supplied round is before it), retry later; `NotFirstRound` = a later round was supplied, re-run the helper;
  `RoundNotProvable` = the round is not in the proxy's current phase, the first round opens a new phase, or a
  round is missing, can never settle → `refundStale`
  after 3 days; `StalePrice` = the first round landed more than `maxStaleness` after `resolveAt`, can never settle
  → `refundStale` after 3 days.
- **Bet events** (unspecified in the PRD): `BetCreated(id, kind, creator, opponent, arbiter, stake, joinBy,
  resolveAt, termsHash)`, plus `PriceBetTerms(id, feed, threshold, creatorAbove)` for price bets (split to avoid
  stack-too-deep without via-ir), `BetJoined(id, opponent)`, `BetCancelled(id)` (from `cancelUnjoined`),
  `BetReported(id, reporter, winner)`, `BetSettled(id, winner, payout, price, roundId)` (price and roundId = 0 for
  mutual bets, also emitted by `arbitrate`), `BetRefunded(id)` (from `refundStale`).
- **`arbitrate` timing:** allowed as soon as both reports exist and conflict, or from `resolveAt + 2 days` when a
  report is missing. Reports can be changed until final, so a party can concede after a conflict.
- **`refund` on a Disputed deal** (arbiter timeout) may be called by buyer or seller; funds always go to the buyer.
- `createPriceBet` additionally requires `threshold > 0`; both bet creators require `joinBy > now` and
  `resolveAt ≥ joinBy + MIN_JOIN_GAP`.

ABI exports (regenerate with `./script/export-abi.sh` after any change):
`shared/abi/TabEscrow.json` (plain ABI array) and `shared/abi/TabEscrow.ts` (`export const tabEscrowAbi = [...] as const`).

## Develop

```sh
export PATH="$HOME/.foundry/bin:$PATH"
forge build
forge test                                              # unit + fuzz + invariant (fork test auto-skips)
forge test --fork-url https://mainnet.base.org          # also runs the Base mainnet fork test
forge coverage --report summary --no-match-path 'test/fork/*'
forge snapshot --no-match-path 'test/fork/*'            # updates .gas-snapshot
```

## Deploy (lead only; not yet broadcast)

The contract has no owner, so the deployer key has no lasting power. Use a throwaway key with ≈ $0.30 of ETH on Base.

```sh
cd contracts
printf 'PRIVATE_KEY=0x...\n' > .env.local        # gitignored; delete after deploy
set -a; source .env.local; set +a

# 1. Dry run (simulates against live Base state; writes nothing)
forge script script/Deploy.s.sol:Deploy --rpc-url https://mainnet.base.org

# 2. Broadcast + Sourcify verification (no API key). Writes ../deployments/base.json
forge script script/Deploy.s.sol:Deploy --rpc-url https://mainnet.base.org --broadcast \
  --verify --verifier sourcify

# 3. Record the tx hash and exact block from the receipt
R=broadcast/Deploy.s.sol/8453/run-latest.json
jq --arg h "$(jq -r '.receipts[0].transactionHash' $R)" \
   --argjson b "$(printf '%d' "$(jq -r '.receipts[0].blockNumber' $R)")" \
   '.txHash = $h | .block = $b' ../deployments/base.json > /tmp/base.json && mv /tmp/base.json ../deployments/base.json

rm .env.local
```

If verification needs retrying (or for Blockscout too):

```sh
ARGS=$(cast abi-encode "constructor(address,address,address[],uint32[])" \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433 \
  "[0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F]" "[3600,3600]")
forge verify-contract <ADDRESS> src/TabEscrow.sol:TabEscrow --chain 8453 --constructor-args $ARGS --verifier sourcify
forge verify-contract <ADDRESS> src/TabEscrow.sol:TabEscrow --chain 8453 --constructor-args $ARGS \
  --verifier blockscout --verifier-url https://base.blockscout.com/api/
```

`deployments/base.json` shape: `{address, txHash, block, chainId: 8453, usdc, sequencerFeed,
feeds: {ETH: {address, decimals, maxStaleness}, BTC: {...}}}`. The script only writes it on a real broadcast, never
on a dry run; `block` is first the pre-broadcast block (a safe indexer lower bound) and step 3 sets the exact one.
