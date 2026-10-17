# Tab — Multiplayer Money for AI Agents

**Product Requirements Document · v1.0 · 2026-10-18**
**Event:** MoonPay Hackathons, Chapter 1: "Build a plugin for the PayBox marketplace"
**Hard deadline:** Sat Oct 17, 8:00 PM New York = **Sun Oct 18, 05:30 IST**. After that: no uploads, no submit.
**Owner:** Adwait · **Build:** parallel Claude agents

---

## 0. TL;DR

Every PayBox plugin today is **single-player**: *my* agent, *my* wallet, *my* trade.
**Tab makes PayBox multiplayer.** Agents move money *between people*:

1. **Requests & splits.** "Split dinner with Meera and Aarav." Each person gets a link. Their agent (or any wallet) pays it, and Tab proves payment on-chain.
2. **Escrowed deals.** "Pay this designer 3 USDC when the logo is delivered." Funds are locked in an immutable contract and released on delivery.
3. **Bets between friends.** "Bet Meera 2 USDC that ETH closes above $4,000 Friday." Both stakes are escrowed and settled trustlessly by a **Chainlink price feed**, or by mutual agreement for real-world events.
4. **Public pay pages with link previews.** Anyone can pay from any wallet. Every payment ends with "Let your agent handle this next time → PayBox". **Every Tab link pulls a new user into PayBox.**

**Pitch line:** *"PayBox gave agents a wallet. Tab gives them each other."*

---

## 1. Ground truth (verified from developer.paybox.sh, docs.paybox.sh, starter v1.0.2)

| Fact | Value |
|---|---|
| Deliverables | (1) a working PayBox plugin, live end to end; (2) a short demo video **posted to X** |
| Prizes | $5k / $3k / $2k + 10 × $1k (split "illustrative"). Winners also get a hardware wallet, perks across MoonPay products, GTM advisory access, and early marketplace listing |
| Suggested categories | Creative, Consumer finance, Merchant tools, Predictions. **Tab spans three of the four** |
| Entries | **One project per person.** You can re-upload and resubmit before the deadline |
| Disqualifier to respect | "automated or AI-generated Submissions … without meaningful human contribution." **Adwait must own product decisions, record and narrate the demo, and do the live runs himself.** |
| Plugin format | Standard TS MCP server → single `dist/plugin.mjs` (≤10 MiB, UTF-8) |
| Toolchain | Node 24.21.0, pnpm 11.11.0, `@modelcontextprotocol/server@2.0.0`, `zod@4.4.3` (`zod/v4`), esbuild 0.28.2, TS 5.9.3, protocol `2026-07-28` |
| Runtime limits | 10 s per operation; fresh sandbox per call (**no memory or disk persistence**); stdout 256 KiB, stderr 16 KiB; ≤256 tools; ≤64 KiB schema per tool; ≤128 content blocks |
| Network | HTTPS to **exact configured hosts only** (≤16). Keep network calls **out of module startup and tool discovery** |
| Secrets | Portal "Secret" = host-scoped **brokered header** injected by PayBox. Plugin never reads it from `process.env`. ≤16 credentials |
| Wallet actions | Return `structuredContent["io.paybox/transactionProposal"]`: `evm` (one call: `to`, `value` wei, `data`), `solana`, or `x402` (Base/Solana USDC). PayBox picks the wallet, simulates, asks for approval, signs, broadcasts. **One transaction per proposal.** No arrays. PayBox **does not add ERC-20 approvals**. |
| Expiry | `expiresAt` must be whole-second UTC within 5 min (helpers default to 4 min) |
| PayBox UI gap | The approval window shows network, sender and raw tx. **It does not decode ERC-20 transfers or allowances.** Our tool text must explain exactly what each proposal does (and stay accurate, because labels are treated as untrusted) |
| Base USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| Submit flow | Upload `plugin.mjs` → hosted checks → **Test** (load tools, run sample) → **Validate transaction** (simulation) → accept T&C → **Submit Project**. After that it appears under *Unofficial plugins* in our PayBox account, where we enable it and drive it from an agent |
| Quotas | 1 plugin start/sec, 1,000 per 24 h; 1 active validation, 30 per hour |

### Our accounts
- **Primary PayBox account** (the browser account, where the developer portal session lives, so the plugin installs here): EVM `evm-default` `0xbeff1786a7ad59a8d62d46ee8d31dfb9a7a73d2e`, Solana `sol-default` `AkHyUfF8nkgop4h2MwSujuBUyUJinVXaXTAWpYbybFBD`. **Fund this one.**
- ⚠️ The Claude PayBox connector is currently linked to a *different* PayBox account (EVM `0xadff…e8cf`, Solana `EGnW…GC4L`). It must be reconnected to the primary account before the live demo, because the plugin only appears in the account that submitted it.
- External wallet (Zerion) `0xB7E07…400A3`: plays **"the friend"** (a non-PayBox payer, which demonstrates the growth loop)
- Target funding (being bridged Polygon → Base): PayBox ≈ 9 USDC + ≈ $1.20 ETH; Zerion ≈ 3.8 USDC + ≈ $1.60 ETH

---

## 2. Problem

1. **Agents can trade alone, not together.** The marketplace has Jupiter, Hyperliquid, Kamino, Aave and World. Each one makes a single agent better at a single-player task. Nothing lets *my* agent and *your* agent settle money.
2. **Everyday group money is still painful in crypto.** Splitting a bill means asking for addresses, copy-pasting hex, checking explorers and guessing who paid. Venmo-style UX doesn't exist on-chain, and it certainly doesn't exist for agents.
3. **Trust between strangers is unsolved for agent commerce.** If an agent hires a freelancer or a friend makes a bet, someone has to trust someone. Escrow solves that, but no agent-native escrow exists in PayBox.
4. **PayBox needs distribution.** A wallet for agents grows when non-users have a reason to touch it. Payment links are the most proven viral loop in fintech (Venmo, Cash App, PayPal.me).

## 3. Insight & positioning

- **Money is social.** The most frequent financial action people take is *paying each other*, not trading.
- **Agents are the missing UX layer.** "Split it with Meera" is a sentence, not a form. PayBox already has the scoped, approval-gated wallet. Tab adds the protocol between wallets.
- **The chain is the receipt.** Tab never asks anyone to trust Tab. Payments are verified from on-chain transfer logs, and escrow lives in an immutable, ownerless contract.
- **Every link is an invitation.** Payers who don't use PayBox still pay easily, then get shown how their agent could do it next time.

**Category:** consumer finance (requests and splits) + merchant tools (escrowed deals) + predictions (social bets).

## 4. Why this wins first place (judge lens)

| What judges likely weigh | How Tab scores |
|---|---|
| Works end to end, live | Real USDC on Base mainnet, real PayBox approvals, verified receipts, shown on camera |
| Uses PayBox deeply | Transaction proposals (ERC-20 transfer, approve, contract calls), brokered secrets (API auth header), network allowlist, approval flow, agent discovery via `discover_plugins` / `use_plugin`, optional x402 rail |
| Usefulness | Bill splitting is a daily habit with hundreds of millions of users. Escrow and bets are real needs |
| Creativity | First **agent-to-agent** money plugin. Prediction markets become personal |
| Strategic value to MoonPay | A **built-in growth loop**: every link is acquisition for PayBox |
| Polish | World-class pay pages, link-preview cards, a cinematic two-person demo |
| Safety | Exact-amount approvals only, immutable contract with no admin keys, an on-chain truth model, phishing protections |

---

## 5. Users & jobs to be done

| Persona | Job |
|---|---|
| **Requester (PayBox user + agent)** | "Get my friends to pay me back without chasing them." "Know who paid without checking explorers." |
| **Payer with PayBox** | "Pay this link from my agent in one sentence, with approval." |
| **Payer without PayBox (the friend)** | "Open a link on my phone, pay from my wallet in two taps, get a receipt." |
| **Buyer / client** | "Pay a freelancer safely: money is locked until they deliver." |
| **Seller / freelancer** | "Prove the client has funds before I start, and get paid automatically if they ghost me after delivery." |
| **Friends who bet** | "Make a bet that settles itself fairly, with no one holding the pot." |

---

## 6. Scope and cut lines

The team is parallel, but the deadline is fixed. **P0 is the submission. P1 makes it first place. P2 only if everything else is green.**

### P0: must ship (the demo depends on it)
- **R1** Payment requests (`tab_request`) with self-contained, shareable links and unique-amount matching
- **R2** Splits (`tab_split`): equal, custom amounts or weights, exact rounding
- **R3** Pay (`tab_pay`): ERC-20 USDC transfer proposal on Base, with pre-flight checks
- **R4** Status (`tab_status`) and list (`tab_list`), **verified on-chain**
- **E1** `TabEscrow` contract deployed and source-verified on Base: deals and bets (price-feed + mutual resolution)
- **E2** Deal and bet tools: create, act and status, with approve-then-act sequencing
- **W1** Web: pay page `/r/[id]`, split page `/s/[id]`, deal page `/d/[id]`, bet page `/b/[id]`, all payable from an injected wallet (Zerion), with live status and receipts
- **W2** Backend API with an authenticated create endpoint (brokered secret) and public read and status endpoints
- **S1** Plugin passes `pnpm test`, hosted checks, a portal tool test and transaction validation; it is submitted
- **S2** A demo video on X, plus submission

### P1: differentiators
- **R5** Dynamic **OG link-preview cards** (amount, memo, status) for WhatsApp, X and iMessage
- **R6** **Creator-signed requests**: the requester's wallet signs the request (EIP-191 via PayBox `request_wallet_sign`), and the pay page shows "Signed by 0xadff…e8cf ✓". This defeats link spoofing
- **R7** **Basename / ENS display** for addresses on pay pages and in tool output
- **X1** **x402 rail**: each request also has an x402 endpoint, so *any* x402-capable agent can pay it, and PayBox can pay it gaslessly with `kind: "x402"`
- **G1** Growth surfaces: post-payment "let your agent handle this" CTA and a copyable agent prompt ("Pay this Tab: <link>")
- **A1** Agent-facing response design: every tool returns a crisp `content` summary plus a typed `structuredContent` with `next_actions` hints

### P2: only if green
- Solana USDC rail for requests (`proposeSolana`, SPL transfer with ATA creation)
- Arbiter-resolved disputes UI; partial-split dispute resolution (basis points)
- Activity feed page `/u/[address]`
- Recurring "tab" between two people (running balance, net settle)

### Explicitly out of scope
Fiat rails, KYC, custodial balances, notifications by email or SMS, upgradeable contracts, fee-taking, tokens other than USDC.

---

## 7. Core user journeys

### J1: Split a bill (hero flow)
1. User → agent: *"Split last night's dinner, 6 USDC, with Meera and Aarav. I paid."*
2. Agent → `tab_split { total: "6", participants: [{label:"Meera"},{label:"Aarav"}], include_self: true, recipient: <user EVM address>, memo: "Dinner at Toit" }`
3. Tab: 6 ÷ 3 = 2.00 each. It assigns **unique amounts** (2.000417 and 2.001288) and creates two requests through the API. It returns two links plus share text.
4. Agent shows: *"Meera owes 2.000417 USDC → tab.link/r/abc…, Aarav owes 2.001288 USDC → tab.link/r/def…"* with share text for each.
5. Meera opens the link on her phone. The preview card reads *"Adwait requested 2.00 USDC · Dinner at Toit"*. She connects Zerion, taps **Pay 2.000417 USDC**, and confirms one ERC-20 transfer.
6. The page detects the transfer on-chain (within ~2–4 s on Base) → **Paid ✓** with a receipt and a Basescan link → CTA "Let your agent handle this next time → PayBox".
7. User → agent: *"Who still owes me?"* → `tab_list` → *"Meera paid 2.00 (tx 0x…). Aarav pending 2.00. You're owed 2.00 USDC."*

### J2: Pay a Tab with your own agent
1. User → agent: *"Pay this: tab.link/r/abc…"*
2. Agent → `tab_pay { link, sender: <user address> }` → Tab fetches the request, checks expiry, checks it's unpaid, checks the sender's USDC and ETH balance, and returns an **EVM proposal**: `to = USDC`, `data = transfer(recipient, 2000417)`, `value = 0`.
3. `content` text states plainly: *"Transfer exactly 2.000417 USDC on Base to 0x9f…12 (requested by 'Adwait', signed ✓). This proposal only transfers USDC; it grants no allowance."*
4. PayBox approval window → user approves → broadcast → the agent polls the request ID → `tab_status` confirms on-chain.

### J3: Escrowed deal (merchant tools)
1. Client → agent: *"Hire 0xSeller to design a logo for 3 USDC, due Monday, 2-day review."*
2. `deal_create` reads the client's USDC allowance for TabEscrow. If it's below 3: it returns an **approve proposal for exactly 3 USDC** (never unlimited), with `next_actions: ["call deal_create again with the same arguments after approval confirms"]`. Otherwise it returns a `createDeal` proposal.
3. The seller gets the link `/d/<id>` and sees "3 USDC locked ✓, due Mon".
4. The seller clicks **Mark delivered** (on the page, from their wallet; or `deal_action deliver` from their agent).
5. The client's agent → `deal_action release` → funds go to the seller.
   - Client goes silent past the review window → the seller can `claim`.
   - Seller never delivers by the deadline → the client can `refund`.
   - Either party can `dispute` if an arbiter was set; the arbiter resolves with a basis-point split.

### J4: Price bet (predictions)
1. User → agent: *"Bet Meera 2 USDC that ETH is above 4,000 at 9 PM tonight."*
2. `bet_create` reads the Chainlink ETH/USD feed. It returns a preview (*"ETH now 3,812.44. You win if ETH/USD ≥ 4,000.00 at 15:30 UTC"*) plus the approve and create proposals.
3. Meera opens `/b/<id>`: a matchup card, the live price, a countdown and a **Join for 2 USDC** button (approve + join).
4. After `resolveAt`, **anyone** calls `settle` (page button or `bet_action settle`). The contract reads Chainlink and pays the winner 4 USDC. No one decides the outcome.
5. If no one joins before `joinDeadline`, the creator gets a full refund.

### J5: Event bet (mutual resolution)
"Bet Meera 2 USDC India wins Sunday." Both parties report the winner. If they agree, it pays out. If they disagree: an arbiter (if one was set) resolves it, otherwise both stakes are refunded after the resolution window. **There's no way to steal funds by lying:** the worst outcome is a refund.

---

## 8. System architecture

```
          ┌──────────────────────── PayBox (MoonPay) ────────────────────────┐
 User ⇄ Agent (Claude via PayBox MCP) ── use_plugin ──► Tab plugin (sandboxed plugin.mjs)
          │   approval window, simulation, signing ◄── proposals ──┘      │ HTTPS (allowlisted)
          └───────────────────────────────┬──────────────────────────────┘      │
                                          │ signed tx                           ▼
                                          ▼                         Tab API (Next.js on Vercel)
                          Base mainnet ── USDC ── TabEscrow ◄─reads─  /api/* + Postgres (metadata)
                                          ▲                                  ▲
                                          │ tx from injected wallet          │
                                   Friend's wallet (Zerion) ── Pay pages /r /s /d /b (+ OG cards)
```

### Trust model ("chain is truth, server is metadata")
- **Money state** (paid, funded, settled) is **always** derived from Base: Transfer logs, contract storage and events. The server caches it, but the plugin and pages re-verify independently.
- **Metadata** (labels, memos, split grouping) lives in Postgres and is **not security-critical**. Integrity of the recipient and amount is protected by the self-contained link payload plus an optional creator signature.
- **The contract** has no owner, no admin, no pause, no upgrade and no fees. It is immutable and source-verified.

### Components
| Component | Tech | Host |
|---|---|---|
| `contracts/` | Solidity 0.8.28, Foundry, OpenZeppelin 5 (SafeERC20, ReentrancyGuard) | Base mainnet |
| `plugin/` | Official starter v1.0.2 + `viem@2.51.3` (exact pin) | PayBox hosted sandbox |
| `web/` | Next.js (App Router, latest stable) + TypeScript strict + Tailwind + shadcn/ui + wagmi/viem + `next/og` | Vercel |
| DB | Postgres (Neon via Vercel Marketplace), Drizzle ORM | Vercel Marketplace |
| Chain reads | Base public RPC with fallbacks; Blockscout API for transfer search | n/a |

---

## 9. Smart contract: `TabEscrow.sol`

### 9.1 Principles
- **USDC only** (immutable constructor arg), so there are no fee-on-transfer or rebasing surprises.
- **No privileged roles.** No owner, pause, upgrade or sweep.
- **Checks-effects-interactions + `nonReentrant`** on every state-changing function. SafeERC20.
- **Exact accounting invariant:** `USDC.balanceOf(escrow) == Σ locked amounts` at all times. Fuzz and invariant tests enforce it.
- Monotonic `uint256 id` per object type. Each object has a `bytes32 termsHash` (hash of off-chain terms or memo) for integrity.
- Custom errors, not revert strings. Full NatSpec.

### 9.2 Deals
```solidity
enum DealState { None, Funded, Delivered, Released, Refunded, Disputed, Resolved }
struct Deal {
  address buyer; address seller; address arbiter;   // arbiter may be address(0)
  uint128 amount;                                   // USDC atomic
  uint64  deliverBy;                                // seller must mark delivered before this
  uint64  reviewWindow;                             // seconds after delivery before seller may claim
  uint64  deliveredAt;
  DealState state;
  bytes32 termsHash;
}
function createDeal(address seller, uint128 amount, uint64 deliverBy, uint64 reviewWindow, address arbiter, bytes32 termsHash) returns (uint256 id); // pulls amount from msg.sender
function markDelivered(uint256 id);          // seller; state Funded, now < deliverBy
function release(uint256 id);                // buyer; Funded|Delivered → Released, pay seller
function claim(uint256 id);                  // seller; Delivered && now ≥ deliveredAt + reviewWindow
function refund(uint256 id);                 // buyer; Funded && now ≥ deliverBy (never delivered)
function cancelBySeller(uint256 id);         // seller; Funded → Refunded (seller declines)
function dispute(uint256 id);                // buyer|seller; arbiter != 0; Funded|Delivered → Disputed
function resolve(uint256 id, uint16 sellerBps); // arbiter only; Disputed → Resolved; split by bps
```
Events: `DealCreated(id, buyer, seller, arbiter, amount, deliverBy, reviewWindow, termsHash)`, `DealDelivered`, `DealReleased`, `DealClaimed`, `DealRefunded`, `DealDisputed`, `DealResolved(id, sellerAmount, buyerAmount)`.
Validation: `seller ≠ buyer`, `seller ≠ 0`, `amount > 0`, `deliverBy > now`, `reviewWindow ∈ [1 min, 30 days]`, `arbiter ∉ {buyer, seller}`.
**Liveness guarantee:** every funded deal reaches a terminal state without the counterparty: the buyer via `refund` after `deliverBy`, the seller via `claim` after review. A disputed deal with an unresponsive arbiter: after `deliverBy + reviewWindow + 30 days`, either party can call `refund` → the buyer gets the funds back (documented).

### 9.3 Bets
```solidity
enum BetKind { Price, Mutual }
enum BetState { None, Open, Matched, Settled, Refunded }
struct Bet {
  address creator; address opponent;     // opponent == 0 → open to anyone until joined
  address arbiter;                        // Mutual only, optional
  uint128 stake;                          // each side
  uint64 joinBy; uint64 resolveAt;
  BetKind kind; BetState state;
  // Price
  address feed; int256 threshold; bool creatorAbove; // creator wins if price ≥ threshold (or < if !creatorAbove)
  // Mutual
  address creatorReport; address opponentReport;     // reported winner
  bytes32 termsHash;
}
function createPriceBet(address opponent, uint128 stake, uint64 joinBy, uint64 resolveAt, address feed, int256 threshold, bool creatorAbove, bytes32 termsHash) returns (uint256);
function createMutualBet(address opponent, uint128 stake, uint64 joinBy, uint64 resolveAt, address arbiter, bytes32 termsHash) returns (uint256);
function joinBet(uint256 id);            // pulls stake; Open → Matched; now < joinBy; msg.sender == opponent or opponent == 0; ≠ creator
function cancelUnjoined(uint256 id);     // creator; Open; refund (any time before join, or after joinBy)
function settlePrice(uint256 id);        // anyone; Matched; now ≥ resolveAt; reads feed
function report(uint256 id, address winner); // creator|opponent; Mutual; now ≥ resolveAt
function arbitrate(uint256 id, address winner); // arbiter; Mutual; reports conflict or missing after grace
function refundStale(uint256 id);        // anyone; Matched; Mutual unresolved after resolveAt + 7 days → refund both
```
**Price resolution rules (oracle safety):**
- `feed` must be in the **constructor-fixed allowlist** (ETH/USD, BTC/USD and similar on Base). No arbitrary feeds.
- Read `latestRoundData()`. Require `answer > 0`, `updatedAt ≥ resolveAt`, `updatedAt ≤ now`, and `now − updatedAt ≤ maxStaleness[feed]`.
- Check the **L2 sequencer uptime feed**: if the sequencer is down, or restarted < 1 h ago, revert `SequencerDown` and retry later.
- If the feed hasn't updated since `resolveAt` (heartbeat), revert `PriceNotFinal` and retry later.
- **Fallback:** if `settlePrice` can't succeed by `resolveAt + 3 days` → `refundStale` refunds both.
- A tie (price == threshold) counts as **≥ for "above"**. This is documented in the preview.
- Winner receives `2 × stake`. Push transfer inside `nonReentrant`.

**Mutual resolution:** both report the same winner → pay. Conflicting reports → arbiter decides if one is set. Otherwise, after `resolveAt + 7 days` → `refundStale` returns both stakes. One report plus silence from the other side → after 7 days, the single report **does not** auto-win (that would reward silence attacks). It refunds instead, unless the arbiter rules.

### 9.4 Constants to verify before deploy (task C-0, do not trust memory)
- Chainlink **ETH/USD** and **BTC/USD** feed proxies on Base mainnet, their **decimals** (8) and **heartbeats**. Source: data.chain.link (Base).
- Chainlink **L2 Sequencer Uptime Feed** on Base. Source: Chainlink L2 sequencer docs.
- USDC on Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (confirmed in the PayBox guide).

### 9.5 Contract tests (Foundry): definition of done
- Unit tests for every function and every revert path (each custom error hit at least once)
- Full state-machine coverage for deals and bets, including time travel (`vm.warp`) across every boundary (`deliverBy`, review window, `joinBy`, `resolveAt`, staleness, the 7-day and 3-day fallbacks)
- Mock aggregator + mock sequencer feed: stale answer, negative answer, sequencer down, grace period, tie
- **Invariant test:** the escrow USDC balance equals the sum of locked amounts, through random sequences of actions by 4 actors
- **Fuzz:** amounts (1 … 1e12), bps (0 … 10000), timestamps
- A **fork test** against Base mainnet: real USDC + real feeds, a full deal and a full price bet
- `forge coverage` ≥ 95% lines on `TabEscrow.sol`; `slither` run, with findings triaged in `contracts/SECURITY.md`
- Gas snapshot committed

### 9.6 Deployment
- Fresh **throwaway deployer key** generated locally (never committed, stored in `contracts/.env.local`, gitignored), funded with ≈ $0.30 ETH on Base from Zerion. The contract has no owner, so the key has no lasting power. It is deleted after deploy.
- `forge script Deploy --broadcast --verify` with **Sourcify / Blockscout verification** (no API key). Basescan verification is optional.
- Output: `deployments/base.json` `{ address, txHash, block, feeds, commit }`. This is consumed by both `plugin/` and `web/`.

---

## 10. Plugin spec (`plugin/`)

### 10.1 Conventions (all tools)
- Name: **`tab`**, title "Tab: multiplayer money", version `1.0.0`.
- Input schemas are `z.object(...).strict()` with tight bounds:
  - Addresses: `^0x[0-9a-fA-F]{40}$`, normalized to checksum via viem `getAddress`.
  - Amounts: decimal strings `^\d{1,9}(\.\d{1,6})?$`, > 0, ≤ **1,000 USDC** (hackathon safety cap, configurable via env `TAB_MAX_USDC`).
  - Memos ≤ 140 chars; control characters stripped; treated as **untrusted**.
- Amount math is exact: `atomicAmount()` from the starter's `paybox.ts`. **No floats anywhere.**
- Every network call: `fetch` with a **4 s `AbortSignal.timeout`**, at most one retry against a fallback host, and a total budget of < 8 s per tool.
- **No network at import or discovery time.**
- Logs go to stderr only, never including secrets or full payloads.
- **Proposal tools** return `structuredContent` = exactly the starter's proposal envelope (use `evmOutputSchema`, `proposeEvm`). Human explanation goes in `content[0].text`; a second text block carries a JSON summary for the agent (`summary`, `next_actions`, `links`).
- **Read tools** return a typed `structuredContent` that matches a declared `outputSchema`, plus a concise text summary.
- Errors: domain failures return `isError: true` with a clear message and remedy (e.g. *"Request already paid in tx 0x…; nothing to do"*). **Never** put a proposal inside an `isError` result.
- Annotations are accurate (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: true` for network tools).
- **Proposal text must be exact and non-promotional:** state the token, the exact atomic amount, the recipient, the contract, and whether it grants an allowance. The approval UI doesn't decode ERC-20 calls, so this text is how the user knows what they're signing.

### 10.2 Network hosts and secrets (portal configuration)
| Kind | Value |
|---|---|
| Host | `<tab-app>.vercel.app` (Tab API) |
| Host | `mainnet.base.org` (primary RPC) |
| Host | `base-rpc.publicnode.com` (fallback RPC) |
| Host | `base.blockscout.com` (transfer search) |
| Env var | `TAB_API_BASE=https://<tab-app>.vercel.app`, `TAB_ESCROW=0x…`, `TAB_MAX_USDC=1000` |
| **Secret** | Host `<tab-app>.vercel.app`, header `Authorization`, value `Bearer <TAB_PLUGIN_KEY>` |

### 10.3 Tools

| # | Tool | Kind | Purpose |
|---|---|---|---|
| 1 | `tab_request` | write (API) | Create one payment request → link |
| 2 | `tab_split` | write (API) | Split a total among N people → N links |
| 3 | `tab_pay` | **proposal** | Pay a request link → USDC transfer proposal |
| 4 | `tab_status` | read | On-chain-verified status of a request, split, deal or bet |
| 5 | `tab_list` | read | Everything open for an address: owed to me, I owe, deals, bets, totals |
| 6 | `deal_create` | **proposal** | Approve (exact) or createDeal |
| 7 | `deal_action` | **proposal** | deliver, release, claim, refund, cancel, dispute, resolve |
| 8 | `bet_create` | **proposal** | Approve (exact) or createPriceBet / createMutualBet, with a live price preview |
| 9 | `bet_action` | **proposal** | join (approve or join), settle, report, arbitrate, cancel, refund |
| 10 | `tab_quote` | read | Live Chainlink price for supported assets (lets the agent phrase bets correctly) |

#### 1. `tab_request`
**Input:** `{ recipient: Address, amount: Decimal, memo?: string, payer_label?: string(≤40), requester_label?: string(≤40), expires_in_hours?: int 1..720 (default 168) }`
**Behavior:**
1. Validate the input. Fetch the current Base block number (RPC) as `start_block`.
2. `POST {TAB_API_BASE}/api/requests` (brokered auth) → the server allocates a 128-bit id and a **unique amount suffix**: `unique = base_atomic + s`, with `s ∈ [1, 9999]` unique among the recipient's open requests with the same base amount. The extra is < 0.01 USDC, shown transparently.
3. Return `{ id, url, amount_display, amount_atomic, unique_amount_display, recipient, memo, expires_at, share_text, pay_prompt }`.

`share_text` example: *"Hey Meera, your share of Dinner at Toit is 2.00 USDC → https://…/r/abc"*. `pay_prompt`: *"Pay this Tab: https://…/r/abc"*.

**Offline fallback:** if the API is unreachable, still return a self-contained `url` (`/r/p.<base64url payload>`) with the request encoded in it. The suffix then derives from `keccak(recipient, amount, created_at, nonce) mod 9999 + 1`.

#### 2. `tab_split`
**Input:** `{ recipient, total: Decimal, participants: [{ label: string, amount?: Decimal, weight?: number(0..1000) }] (1..20), include_self?: boolean (default true), memo?, tip_percent?: 0..50 }`
**Rules:**
- Modes are mutually exclusive: all `amount` set (custom; must sum to ≤ total, the remainder is the requester's share), or all `weight` set, or neither (equal).
- **Rounding:** compute in atomic units with the **largest-remainder method**, so shares sum exactly to the total. The requester absorbs rounding when `include_self`.
- Creates one split + N requests in one API call.

**Output:** `{ split_id, split_url, total, per_person: [{ label, amount, unique_amount, url, share_text }], your_share }`

#### 3. `tab_pay` (proposal)
**Input:** `{ link_or_id: string, sender: Address }`
**Steps:**
1. Resolve the request (API, or decode the `p.` payload).
2. **Integrity checks:** the payload recipient/amount match the API record; if a creator signature exists, verify it (`viem verifyMessage`) and flag `signed: true`.
3. Status checks: not paid (on-chain check, see the matching algorithm in §11.3), not expired, `sender ≠ recipient`.
4. Balance check via RPC: USDC ≥ amount; ETH > a minimal gas estimate. If insufficient → `isError` with a specific top-up remedy (deposit URL `https://app.paybox.sh/deposit`).
5. Return `proposeEvm({ chain: "eip155:8453", to: USDC, value: "0", data: transfer(recipient, unique_atomic) })`.

**Text:** *"Pays request 'Dinner at Toit' from Adwait: transfer exactly 2.000417 USDC on Base to 0x9f…12. No allowance is granted. Signed by recipient ✓."*

#### 4. `tab_status`
**Input:** `{ ref: string }`, which accepts a request link or id, a split link or id, `deal:<id>`, `bet:<id>`, or `/d/<id>` and `/b/<id>` URLs.
**Output (discriminated union by `type`):**
- request: `{ status: open|paid|expired, paid_tx?, paid_at?, payer? }`
- split: an aggregate of its requests plus `{ collected, outstanding }`
- deal / bet: state, parties, amounts, deadlines, and `available_actions[]` for the caller's perspective (computed from on-chain state and time)

#### 5. `tab_list`
**Input:** `{ address: Address, include?: ["requests","deals","bets"], status?: "open"|"all" }`
**Output:**
- Lists: `owed_to_you[]`, `you_owe[]` (requests where `payer_address` is known from a prior `tab_pay` or page connect), `deals[]`, `bets[]`.
- Totals: `owed_to_you_total`, `locked_in_escrow_total`.
- A one-paragraph summary: *"You're owed 2.00 USDC (Aarav). Meera paid 2.00 at 21:14. 3 USDC locked in 1 deal. 1 bet resolving in 42 min."*

Deals and bets come from contract events filtered by participant (API indexer), re-verified on-chain for each returned id (bounded to 10 ids per call).

#### 6. `deal_create` (proposal)
**Input:** `{ buyer: Address, seller: Address, amount, deliver_by: ISO-8601, review_hours: 0.0167..720 (default 48), arbiter?: Address, terms: string ≤500 }`
**Steps:**
1. Read `allowance(buyer, TabEscrow)`.
2. If below `amount`: return an **approve proposal for exactly `amount`** with `next_actions: ["After the approval confirms, call deal_create again with identical arguments"]`.
3. Otherwise return a `createDeal` proposal (`termsHash = keccak256(terms)`). Store the terms text via the API, keyed by `termsHash`, so pages can show it.

The text always says which step this is: *"Step 1 of 2: allow TabEscrow (0x…) to move exactly 3.00 USDC."*

#### 7. `deal_action` (proposal)
**Input:** `{ deal_id: int, action: "deliver"|"release"|"claim"|"refund"|"cancel"|"dispute"|"resolve", caller: Address, seller_bps?: 0..10000 }`
**Steps:**
1. **Pre-validate against on-chain state and the caller's role.** If the call would revert, return `isError` explaining why, plus when it becomes possible (e.g. *"Refund available after Mon 18:00 IST"*).
2. Simulate via `eth_call` from `caller` before proposing. A revert → `isError` with the decoded custom error.

#### 8. `bet_create` (proposal)
**Input:** `{ creator: Address, opponent?: Address, stake: Decimal, kind: "price"|"event", join_within_hours: 0.0167..168, resolve_at: ISO-8601, price?: { asset: "ETH"|"BTC", side: "above"|"below", threshold: Decimal }, event?: { description: string ≤280, arbiter?: Address } }`
**Steps:**
1. Price bets read the feed and include a **preview**: current price, threshold, side, resolve time in UTC and IST, tie rule, oracle source.
2. Reject impossible bets: `resolve_at` ≤ now + 5 min, or `join_within` past `resolve_at`.
3. Approve-then-create sequencing, as in `deal_create`.

**Output:** the proposal, plus the bet page URL for sharing after creation.

#### 9. `bet_action` (proposal)
**Input:** `{ bet_id, action: "join"|"settle"|"report"|"arbitrate"|"cancel"|"refund", caller, winner?: Address }`
- `join` does approve-then-join sequencing.
- `settle` pre-checks the oracle freshness and sequencer status and explains when to retry.

#### 10. `tab_quote`
**Input:** `{ asset: "ETH"|"BTC" }` → `{ price, updated_at, feed, decimals }`.

### 10.4 `paybox-plugin.json` sample (must pass hosted checks with no wallet and no secrets)
`{"tool":"tab_quote","arguments":{"asset":"ETH"}}`. It's read-only and needs only the RPC host, so hosted checks are robust.

### 10.5 Plugin tests (beyond conformance)
- `vitest` unit tests:
  - amount parsing and atomic math (exhaustive edge cases)
  - largest-remainder split (property test: shares sum to the total; each share ≥ 0; deterministic)
  - payload encode/decode round-trip and tamper detection
  - calldata encoding matches viem `decodeFunctionData`
  - every input-schema rejection path
- Integration tests with **mocked fetch** for API, RPC and Blockscout: the happy path and every error path (timeout, 5xx, malformed JSON, already-paid, expired, insufficient balance)
- `pnpm test` (official): typecheck + deterministic double build + conformance must pass. **Do not edit the starter's tooling files.**

---

## 11. Backend & API spec (`web/app/api`)

### 11.1 Data model (Postgres, Drizzle)
```
requests(id text pk, split_id text null, recipient text, amount_atomic numeric, unique_atomic numeric,
         memo text, payer_label text, requester_label text, created_at timestamptz, expires_at timestamptz,
         start_block bigint, signature text null, status text, paid_tx text null, paid_at timestamptz null,
         payer_address text null)
         unique(recipient, unique_atomic) where status = 'open'
splits(id text pk, recipient text, total_atomic numeric, memo text, created_at timestamptz)
terms(hash text pk, body text, created_at timestamptz)            -- deal/bet terms by keccak hash
chain_cursor(name text pk, block bigint)                          -- indexer cursor for escrow events
escrow_objects(kind text, id bigint, participants text[], state text, updated_block bigint, pk(kind,id))
```

### 11.2 Endpoints
| Method / path | Auth | Purpose |
|---|---|---|
| `POST /api/requests` | Bearer plugin key | Create a request (allocate id + unique amount) |
| `POST /api/splits` | Bearer | Create a split + N requests atomically (one transaction) |
| `POST /api/terms` | Bearer | Store terms text; the server verifies `keccak256(body) == hash` |
| `POST /api/requests/:id/signature` | none | Attach a creator signature; **server verifies it** recovers to the recipient |
| `GET /api/requests/:id` | public | Metadata |
| `GET /api/requests/:id/status` | public | On-chain verified status (cached 3 s; re-checks if open) |
| `GET /api/splits/:id` | public | Split + member statuses |
| `GET /api/addresses/:addr/tabs` | public | Open requests to and from the address, deals, bets |
| `GET /api/escrow/deals/:id`, `/bets/:id` | public | Decoded on-chain object + terms |
| `GET /api/x402/r/:id` | public | x402 resource (P1, §13) |
| `GET /api/health` | public | Liveness + RPC reachability |

- **Rate limits:** creation 60/min per key; public reads 120/min per IP (Vercel Firewall rule or an in-app token bucket).
- **Input validation:** zod on every route; reject unknown fields.
- **Auth:** constant-time comparison of the bearer token against `TAB_PLUGIN_KEY` (Vercel env, sensitive).
- **IDs:** 22-char base62 from `crypto.getRandomValues` (128 bits).

### 11.3 Payment matching algorithm (no trust in the server)
A request is **paid** iff there is a USDC `Transfer(from = any, to = recipient, value = unique_atomic)` with `block ≥ start_block`, and that tx is not already assigned to another request.

1. **Primary:** Blockscout `GET /api/v2/addresses/{recipient}/token-transfers?type=ERC-20&filter=to&token={USDC}`, paginated until `block < start_block`.
2. **Fallback:** RPC `eth_getLogs` (topic0 = Transfer, topic2 = recipient) in ≤ 2,000-block chunks from `start_block`. The time budget is enforced; partial scans report `status: "checking"`, never "unpaid".
3. **First match wins:** the earliest qualifying transfer by (block, logIndex).
4. **Overpay or underpay:** an exact-match requirement keeps it unambiguous. The page offers only the exact amount, and a mismatch is shown as "not matched; contact requester".

### 11.4 Escrow indexer
- A Vercel Cron job every minute (and on demand on page view) pulls `TabEscrow` events since the cursor and upserts `escrow_objects`. Used only for **listing by participant**.
- Every detail view reads contract storage directly.

---

## 12. Web app spec (`web/`): the pay pages people actually see

### 12.1 Design direction
> **Owner-approved update:** Stripe × Linear × Cash App polish, with the soul of **Family wallet** (family.co).
> - **Palette:** warm off-white `#FBFAF9` and dark `#121212`; brand blue `#1A88F8` (hover `#4DAFFF`); sunny `#FEBE44` for celebrations; mint for Paid.
> - **Type and motion:** Figtree (free) with Geist Mono; expo-out easing `cubic-bezier(0.19,1,0.22,1)`; per-word 3D headline reveals.
> - **Components:** pill buttons; bottom sheets; dynamic-island status toasts; a custom dotted QR code; a receipt moment where the card flips into a perforated ticket.
> - **Illustration:** our own CSS/SVG objects. Family's assets and fonts are reference only and must not be copied.
> The text below remains the baseline; this note wins where they conflict.

Calm, premium, money-grade, in the spirit of **Stripe Checkout × Linear × Cash App**.
- **Type:** Geist Sans (UI) + Geist Mono (amounts, addresses), tabular numerals for amounts.
- **Scale:** 12 / 14 / 16 / 20 / 28 / 40 / 64; **the amount is the single focal point** at 64px, weight 600, tracking −0.03em.
- **Color:** near-black ink on warm off-white (light); deep graphite (dark). One accent: **PayBox-adjacent mint/teal** for primary actions and "Paid". Semantic: success = mint, pending = amber, error = red (all WCAG AA).
- **Surfaces:** a single centered card (max-w 440px) with layered soft shadows and a 20px radius, over a subtle CSS mesh-gradient + noise background. No stock imagery.
- **Motion:** 150–250 ms ease-out. Status transitions **Pending → Confirming → Paid** use a morphing check and a number roll. Respect `prefers-reduced-motion` (crossfade only).
- **Dark mode**, fully supported via `prefers-color-scheme` plus a toggle.

### 12.2 Pages
**`/r/[id]` (request):**
- Requester label + Basename/ENS (P1) + "Signed ✓" badge (P1), the memo, and a **huge amount**
- Fine print: "2.00 USDC + 0.000417 matching code"
- Recipient address (mono, copy button, truncated middle), network badge "Base"
- **Primary CTA:** `Connect wallet` → `Pay 2.000417 USDC` (wagmi `writeContract` USDC `transfer`)
- **Secondary:** "Pay with your agent" (copies `Pay this Tab: <link>` + shows PayBox instructions)
- **States:**
  - loading skeleton
  - open
  - wrong network (one-click switch to Base)
  - insufficient balance (show balance + "Get USDC" → PayBox/MoonPay)
  - awaiting signature
  - confirming (tx hash link)
  - **paid** (receipt card: amount, from, to, time, tx; confetti-free, tasteful check animation)
  - expired
  - not found
- **After paid:** growth card *"Get paid like this. Your agent can split, request and settle for you → Start with PayBox"* (link to `https://app.paybox.sh`)

**`/s/[id]` (split):** total, a progress bar (collected/total), and a member list with per-person status chips and individual pay buttons.

**`/d/[id]` (deal):**
- A **timeline**: Funded → Delivered → Released (or Refunded/Disputed), with the terms text and its verified-hash badge
- Role-aware actions for the connected wallet (deliver, release, claim, refund, dispute), each with a clear consequence sentence before the wallet prompt
- A countdown to the next deadline

**`/b/[id]` (bet):**
- A matchup card (creator vs opponent, stake each, pot)
- **Price bets:** a live price ticker from Chainlink (polled every 10 s), the threshold line, a countdown, and who's currently winning
- **Event bets:** the description and both reports
- Actions: Join (approve → join, with a two-step progress indicator), Settle (enabled after `resolveAt` with an oracle-freshness note), Report, Cancel, Refund

**`/` (landing):** a one-screen story with an animated demo of an agent chat creating a split, a "How it works" section in 3 steps, and "Install in PayBox" instructions.

### 12.3 OG images (P1, high leverage)
`next/og` per page, 1200×630:
- **Request:** big amount, memo, requester, status pill
- **Bet:** "Adwait vs Meera · 2 USDC each · ETH ≥ $4,000 by 9 PM"

Cached by id + status. These make links look trustworthy in WhatsApp and X, which helps the viral loop.

### 12.4 Wallet connectivity
- wagmi + viem; injected connector first (Zerion extension and mobile in-app browser), plus Coinbase Wallet connector
- WalletConnect only if a free project ID is available (P2)
- Base chain only; auto-prompt to switch network

### 12.5 Quality bar
- Lighthouse ≥ 95 on Performance, Accessibility and Best Practices for `/r/[id]` (mobile)
- Full keyboard navigation and visible focus; semantic HTML; `aria-live` for status changes
- 360px width is fully usable: no horizontal scroll, 16px gutters, tap targets ≥ 44px
- `robots: noindex` on all `/r`, `/s`, `/d`, `/b` pages (unlisted links)
- The **design-critic** agent reviews before submission; apply its top fixes

---

## 13. x402 rail (P1): "any agent can pay a Tab"

- `GET /api/x402/r/:id` responds **402** with x402 payment requirements: `scheme: "exact"`, network Base, asset USDC, `maxAmountRequired = unique_atomic`, `payTo = recipient`, and a resource description.
- On a valid `X-PAYMENT` / `PAYMENT-SIGNATURE` header: verify and settle through an x402 **facilitator** that supports Base mainnet. Candidates must be verified first: a public facilitator that needs no key, or Coinbase CDP if the account and keys are available. On settle, mark the request paid with the settlement tx and return 200 with a JSON receipt.
- **In PayBox:** `tab_pay { rail: "x402" }` returns `proposeX402({ chain: "eip155:8453", url, maxAmount: unique_atomic })`. PayBox fetches the 402, checks the asset and amount, the user approves, and PayBox pays **gaslessly** (EIP-3009).
- **Gate:** ship only if an end-to-end paid test succeeds on mainnet with ≤ 0.10 USDC. Otherwise hide `rail` and mention x402 as roadmap in the video.

---

## 14. Security & abuse threat model

| Threat | Mitigation |
|---|---|
| Spoofed request (attacker sends a link with your name and their address) | The recipient address is always shown prominently with its Basename. A "Signed by recipient ✓" badge only appears when the signature verifies; unsigned links say "Unsigned request: verify the address with the sender". The requester label is styled as untrusted user text |
| Tampered self-contained link | The API record is authoritative when present; a payload/API mismatch → hard error. Payload-only links show "Unverified" |
| Unlimited approvals | **Exact-amount approvals only**, everywhere. The text states the amount |
| Malicious memo or labels (prompt injection to agents, XSS) | Length limits, control-character stripping, rendered as text (React escaping), and labelled as user content in tool output. The plugin never interprets memo content |
| Oracle manipulation or staleness | Allowlisted Chainlink feeds only; staleness, `updatedAt ≥ resolveAt` and sequencer checks; refund fallback |
| Griefing (opponent never joins; counterparty silent) | `joinBy` refund, deal deadlines, review-window claim, stale refunds. Every lock has an exit that needs no one's cooperation |
| Reentrancy, accounting bugs | CEI + `nonReentrant`, SafeERC20, an invariant test, slither, USDC-only |
| API key leakage | The brokered header is injected by PayBox, never in the bundle; key rotation needs no re-upload; responses never echo it |
| DoS on API | Rate limits, bounded queries, cached status, Vercel Firewall |
| Double-matching one transfer | Unique `(recipient, unique_atomic)` among open requests; one tx is assigned to one request |
| Wrong network or token | Base-only, USDC-only; network switch enforced on pages; the plugin hardcodes chain and token |
| Hackathon T&C | No exfiltration or misuse of credentials; we never ask for keys; the throwaway deployer key is never committed |

---

## 15. Privacy
- No emails, phone numbers or real names are required. Labels are free text chosen by the user; the UI encourages first names.
- Links are unguessable and unlisted (`noindex`). Memo text is visible to anyone with the link, and the creation UI says so.
- On-chain data is public by nature; the page states "Payments are public on Base."
- No analytics cookies. Vercel Web Analytics only (cookieless), or none.

---

## 16. Edge cases (must be handled and tested)

| Case | Expected behavior |
|---|---|
| Payer sends a slightly different amount | Not matched; the page shows the exact amount and an explanation; the requester's agent sees "unmatched transfers" when listing (P2) |
| Same person pays twice | The second payment isn't matched to the same request. The page blocks a second pay when status = paid (on-chain check before enabling the button) |
| Request expired but paid later | Status `paid_late` (still recognized), flagged |
| Split rounding 10 / 3 | 3.333334 + 3.333333 + 3.333333 = 10 exactly; the requester absorbs the extra unit |
| RPC down / rate limited | Fallback host; status "checking", never "unpaid"; the tool explains |
| Approve confirmed but create not yet called | `deal_create` rerun detects sufficient allowance → returns the create proposal |
| Allowance left over after a failed create | Harmless (exact amount); `tab_list` surfaces "approved but unused" (P2) |
| Opponent joins after `joinBy` | Reverts `JoinClosed`; the tool pre-checks and explains |
| `resolveAt` passed but the feed hasn't updated | `PriceNotFinal`; the tool says "retry in ~N min (feed heartbeat)" |
| Sequencer down | `SequencerDown`; retry later; refund path after 3 days |
| Sender == recipient | Rejected with a friendly message |
| Amount above the cap | Rejected with the cap shown |
| Proposal expires before approval (5 min) | The agent re-calls the tool for a fresh proposal; the text explains |

---

## 17. Observability
- Plugin: structured stderr logs `{tool, phase, ms, outcome}` (no payloads), within 16 KiB.
- API: Vercel logs + one log line per request with route, status and latency. `/api/health` checks RPC and DB.
- Contract: events are the audit trail, linked from every page.

---

## 18. Repo layout & parallel workstreams

```
paybox-hackathon/
  docs/PRD.md                 ← this file
  deployments/base.json       ← single source of truth: escrow address, feeds, block
  contracts/                  ← Foundry (WS-C)
  plugin/                     ← official starter v1.0.2, untouched tooling (WS-P)
    src/plugin.ts  src/paybox.ts  src/tools/*.ts  src/lib/{amount,split,payload,chain,api}.ts
  web/                        ← Next.js app + API + DB (WS-W)
  shared/abi/TabEscrow.json   ← ABI exported from contracts, imported by plugin + web
```

| Workstream | Owner | Depends on | Delivers | Interface contract |
|---|---|---|---|---|
| **WS-C** Contracts | Agent C | §9.4 constants | `TabEscrow.sol`, tests, deploy, `deployments/base.json`, `shared/abi` | ABI + events frozen at the "ABI freeze" gate |
| **WS-P** Plugin | Agent P | the ABI (can start from a draft ABI), API routes (§11.2, can mock) | `dist/plugin.mjs` passing `pnpm test` + vitest | Tool schemas exactly as in §10.3 |
| **WS-W** Web + API | Agent W | ABI, DB provisioning | Pages, API, OG, indexer, deployed on Vercel | Endpoints exactly as in §11.2 |
| **WS-X** x402 | Agent X | WS-W | `/api/x402/r/:id` + facilitator integration, behind a flag | Gate in §13 |
| **WS-Q** QA + design critique | Agent Q | all | E2E script on mainnet with tiny amounts, design-critic pass, security review (security-auditor agent) on contract + API | Bug list prioritized P0/P1 |
| **WS-D** Demo & submission | **Adwait** + Claude | all P0 | Portal upload, config, checks, Submit, video, X post | §20 checklist |

**Rules for agents:** strict TypeScript (no `any`), zod at every boundary, no secrets in the repo, tests ship with features, and match the starter's idioms. Contract ABI changes after the freeze require lead sign-off.

---

## 19. Timeline (IST, Sun Oct 18). Hard gates, not estimates

| Time | Gate |
|---|---|
| 00:45 | PRD approved → WS-C, WS-P and WS-W start in parallel; ABI drafted first (≤20 min) |
| 01:45 | **ABI freeze.** Contract tests green; deployer funded; **contract deployed and verified on Base** |
| 02:15 | Web + API deployed to Vercel (DB provisioned, plugin key set); `/r/[id]` pays end to end from Zerion |
| 02:45 | Plugin `pnpm test` green with real hosts → **first upload to the portal**; hosts, env and secret configured; hosted checks pass |
| 03:15 | Portal **Test**: `tab_request` and `tab_split` run live; `tab_pay` + `deal_create` **Validate transaction** passes. **Submit Project (v1).** It's now safe; later uploads are improvements |
| 03:15–04:15 | Enable the plugin in PayBox → full live run through Claude + PayBox approvals + Zerion as friend → record the video. P1 items are merged only if they don't break the gates; re-upload + resubmit if improved |
| 04:30 | **Final upload + Submit locked.** Video posted on X; link ready |
| 05:30 | Deadline (one hour of buffer kept on purpose) |

---

## 20. Demo video (≈90 s, recorded and narrated by Adwait) & submission checklist

**Script:**
1. **0–8 s, hook.** *"Agents can trade. They still can't split a dinner bill. Tab makes PayBox multiplayer."*
2. **8–35 s, split.** In Claude: "Split dinner, 3 USDC, with Meera." → links appear → cut to the phone showing the WhatsApp preview card → Zerion pays → the page flips to **Paid ✓** → in Claude: "who owes me?" → "Meera paid. Tx 0x…".
3. **35–60 s, bet.** "Bet Meera 1 USDC ETH is above X at 21:30." → PayBox approval window → Meera joins on the bet page → (time cut) anyone hits Settle → Chainlink decides → the winner is paid.
4. **60–80 s, deal.** "Hire Meera to design a logo, 1 USDC, release on delivery." → funds locked → she marks delivered → "release it" → paid.
5. **80–90 s, close.** *"Every Tab link brings someone new into PayBox. Agents finally have each other."* Show the repo, the contract address and the X handle.

**Production:** a 1080p screen capture, real-time segments, captions burned in, no fake screens. All transactions are real on Base mainnet with ≤ 3 USDC total exposure.

**Submission checklist:**
- [ ] `pnpm test` green; `dist/plugin.mjs` uploaded (only this file)
- [ ] Hosts, env vars and the secret configured; hosted checks pass
- [ ] Portal Test run for `tab_quote`, `tab_request` and `tab_status`; Validate transaction passed for `tab_pay` and `deal_create`
- [ ] Project name **"Tab: multiplayer money for agents"** (≤80 chars). Description (≤280): *"Agents can trade alone; Tab lets them settle money with each other. Split bills, request USDC, lock escrowed deals and settle friendly bets on Base with Chainlink. Every pay link brings a new user into PayBox."*
- [ ] T&C accepted → **Submit Project** clicked (before 04:30 IST)
- [ ] Plugin enabled under Unofficial plugins; the live agent run worked
- [ ] Video posted on X (tagging @moonpay and PayBox if appropriate), link saved
- [ ] Contract verified; repo README with architecture, addresses and how to run

---

## 21. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bridged funds arrive late | Medium | Build and test on a Base mainnet fork with Anvil; deploy as soon as $0.30 ETH lands |
| Hosted sandbox blocks a host or times out | Medium | Read-only sample tool; 4 s timeouts; fallback RPC; test in the portal early (02:45 gate) |
| PayBox simulation rejects approve or create | Low–Med | Validate each proposal in the portal; exact allowance; pre-simulate with `eth_call` |
| Chainlink feed address wrong | Low | Task C-0 verification + fork test against the real feed before deploy |
| x402 facilitator unavailable on mainnet | Medium | P1 behind a gate; the P0 transfer rail is unaffected |
| Plugin review not approved for public listing | High (manual review) | Irrelevant to judging: private install works for the demo. The T&C say listing is separate from prizes |
| "AI-generated without meaningful human contribution" clause | Low–Med | Adwait owns the decisions, live runs, narration and video; the PRD and decisions are documented |
| Scope overrun | Medium | P0/P1/P2 cut lines and hard gates; **Submit v1 at 03:15 no matter what** |

---

## 22. Decisions made (for the record)
1. **Base over Polygon:** the PayBox guide documents Base for EVM proposals and x402; Polygon signing support is unverified.
2. **Direct ERC-20 transfer for requests (not escrow):** one transaction, no approval, the cheapest and fastest UX. Escrow is used only where trust is needed.
3. **Unique-amount matching:** stateless verification from public chain data, with no custom contract for requests.
4. **Ownerless, immutable escrow:** the strongest trust story; no admin key risk.
5. **Price bets via Chainlink, event bets via mutual reporting with refund-on-conflict:** trustless where an oracle exists, safe where it doesn't.
6. **Postgres metadata + self-contained link fallback:** pages work even if the DB is down.

## 23. Open questions (owner: Adwait)
- Friend's display name for the demo ("Meera" placeholder)?
- Custom domain for links (nicer previews), or `*.vercel.app` for now?
- Should the X post tag MoonPay/PayBox accounts? Confirm handles before posting.
