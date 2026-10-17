# TabEscrow security review

Slither is not installed in this environment, so this is a manual review against PRD §9 and §14. Run
`slither .` before mainnet if time allows and triage findings here.

## Checklist

| # | Threat / property | Mitigation in `TabEscrow.sol` | Evidence |
|---|---|---|---|
| 1 | Privileged keys (rug, pause, upgrade, fee skim) | No owner, admin, pause, upgrade, sweep or fee code paths. Token, sequencer feed and feed allowlist are fixed in the constructor. | Source; ABI has no admin functions |
| 2 | Reentrancy | Every state-changing function is `nonReentrant` **and** follows CEI: state is set to the next (terminal) state and the event emitted before any transfer. | Source review |
| 3 | Accounting drift | Invariant: `balance == Σ locked + Σ owed`. Funds enter only in `createDeal`/`createPriceBet`/`createMutualBet`/`joinBet` and leave only on a transition out of a locking state, which can happen once. USDC-only (no fee-on-transfer / rebasing). `resolve` pays `amount·bps/1e4` + remainder, so the split is exact. | `invariant_balanceEqualsLocked` (256 runs × 64 calls, 4 actors), `testFuzz_resolve_conservesFunds` |
| 4 | Non-standard ERC20 returns | `SafeERC20` for all transfers. | Source |
| 5 | Oracle manipulation | Feeds restricted to a constructor-fixed allowlist (Chainlink ETH/USD, BTC/USD on Base). | `test_createPriceBet_revertsOnFeedNotAllowed` |
| 6 | Oracle staleness / bad answers | Require `answer > 0`, `updatedAt ≤ now`, `updatedAt ≥ resolveAt` (`PriceNotFinal`), and the settling round published within `maxStaleness` (3600 s = 3× heartbeat) of `resolveAt` (`StalePrice`). | `test_settlePrice_*` |
| 6a | Settlement timing / cherry-picking the price | `settlePrice(id, roundId)` uses a historical round, not the latest answer. The contract proves `roundId` is the **first** round at/after `resolveAt`: `getRoundData(roundId).updatedAt ≥ resolveAt` and `getRoundData(roundId − 1).updatedAt < resolveAt`, with both rounds in the same phase (aggregator round ≥ 2, so `roundId − 1` cannot cross a phase) and the predecessor present (non-zero, non-reverting, else `RoundNotProvable`). Any later round fails `NotFirstRound`. The outcome is fixed by oracle history; when or by whom it is called cannot change it. | `test_settlePrice_lateSettlementUsesFirstRound`, `..._revertsWhenPredecessorAlsoAfterResolveAt`, `..._acrossPhaseBoundary`, `..._revertsOnFirstRoundOfPhase`, `..._revertsOnMissingRound`, `test_fork_fullPriceBet` (real Base round) |
| 6b | Rounds from a superseded aggregator phase | `settlePrice` requires the round's phase (`roundId >> 64`) to equal the proxy's current `phaseId()`; an unreadable phase reverts `RoundNotProvable`. | `test_settlePrice_revertsOnRoundFromSupersededPhase`, `..._revertsWhenPhaseUnreadable`, `test_fork_constantsMatchChain` |
| 7 | L2 sequencer outage | Uptime feed must report up (`answer == 0`), have a non-zero `startedAt`, and have been up for > 1 h (`SequencerDown`). | `test_settlePrice_revertsWhenSequencerDown`, `..._sequencerGraceBoundary`, `..._revertsOnUninitialisedSequencerRound` |
| 8 | Oracle never becomes usable | `refundStale` refunds both sides from `resolveAt + 3 days`, callable by anyone. | `test_refundStale_priceBoundary`, `..._sequencerDownFallback` |
| 9 | Griefing: opponent never joins | Creator can `cancelUnjoined` at any time while Open; joins close at `joinBy`. | `test_cancelUnjoined_*`, `test_joinBet_joinByBoundary` |
| 10 | Griefing: seller never delivers | Buyer `refund` from `deliverBy`. | `test_refund_afterDeadlineBoundary` |
| 11 | Griefing: buyer never releases | Seller `claim` from `deliveredAt + reviewWindow`. | `test_claim_reviewWindowBoundary` |
| 12 | Griefing: arbiter unresponsive on a deal | Either party `refund`s to the buyer from `disputedAt + 30 days`. | `test_refund_disputedAfterArbiterTimeoutBoundary` |
| 12a | Late dispute to block a due exit | `dispute` only while Funded before `deliverBy`, or Delivered within the review window (`TooLate` otherwise), so a party cannot freeze a `refund`/`claim` that is already due. | `test_dispute_fundedClosesAtDeliverBy`, `test_dispute_deliveredClosesAtReviewEnd` |
| 13 | Silence attack on mutual bets | A lone report never wins. Arbiter (if any) may rule from `resolveAt + 2 days`; otherwise `refundStale` from `resolveAt + 7 days`. | `test_refundStale_loneReportDoesNotAutoWin`, `test_arbitrate_missingReportGraceBoundary` |
| 13a | Free option for a late joiner | `resolveAt ≥ joinBy + MIN_JOIN_GAP` (10 min), so nobody can join a price bet moments before an all-but-known outcome. | `test_createBet_deadlineValidation` |
| 13b | Recipient that cannot receive (USDC blacklist) blocks a payout | Payouts try a direct transfer; on failure the amount is credited to `owed[to]` (`PayoutDeferred`) and the transition still completes, so the counterparty is paid. `withdraw()` (nonReentrant, CEI) claims it later. No `withdrawTo`, so blacklisted funds cannot be redirected. | `TabEscrowPayoutsTest`, invariant with `toggleBlocked` |
| 14 | Self-dealing / role confusion | `seller ∉ {0, buyer}`, `arbiter ∉ {buyer, seller}`, `opponent ≠ creator`, joiner ∉ {creator, arbiter}, mutual arbiter ∉ {creator, invited opponent}, winner ∈ {creator, opponent}. | `test_*_revertsOn*` |
| 15 | Unbounded / malformed params | `amount > 0`, `deliverBy > now`, `reviewWindow ∈ [1 min, 30 d]`, `joinBy > now`, `resolveAt ≥ joinBy`, `threshold > 0`, `sellerBps ≤ 10000`. Constructor rejects zero addresses, duplicate feeds, zero staleness and length mismatches. | Constructor + create tests |
| 16 | Unlimited approvals | Contract pulls exactly `amount`/`stake`; the plugin and pages request exact-amount approvals only. | `test_createDeal_revertsWithoutAllowance` |
| 17 | Arithmetic | Solidity 0.8 checked math; deadline sums are done in `uint256`; the two narrowing casts are provably in range (commented). | Source |

## Accepted risks (documented, not bugs)

- **Unprovable first round.** If the first round after `resolveAt` is the first round of a new Chainlink phase
  (a proxy aggregator upgrade at that exact moment) or arrives later than `maxStaleness`, the bet can never be
  settled and `refundStale` returns both stakes after 3 days. Rare, and fails safe (refund, never a wrong payout).
- **Deferred payouts.** A blacklisted recipient's share sits in `owed` until Circle lifts the blacklist; it can never
  be redirected. A caller could also force a deferral by under-supplying gas to the inner transfer (63/64 rule);
  that only costs the recipient one extra `withdraw`, never funds.
- **Arbiter trust.** An arbiter, when chosen, fully decides a dispute (any split) or a conflicted mutual bet.
  Parties opt in by naming them; `address(0)` disables arbitration.
- **Races at boundaries are first-come-first-served**, e.g. `release` vs `dispute` within the review window,
  `arbitrate` vs `refundStale` after 7 days, `resolve` vs `refund` after the dispute timeout (`disputedAt + 30 d`). Each outcome is a
  valid terminal state and the accounting invariant holds in all orderings.
- **Sequencer feed failure** (reverting or never reporting up) blocks price settlement; `refundStale` still
  returns both stakes after 3 days.
