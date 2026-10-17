# Tab API contract (plugin ⇄ web)

Owner: WS-P (plugin). Consumer/implementer: WS-W (web). Source of truth for field names and units.
The plugin's zod parsers live in `plugin/src/lib/api.ts` and match this file exactly.

## Global rules

- Base URL: `TAB_API_BASE` (e.g. `https://tab-pay.vercel.app`), no trailing slash.
- JSON only. Request and response bodies are `application/json; charset=utf-8`.
- **Atomic amounts are decimal strings** of USDC base units (6 decimals): `"2000417"` = 2.000417 USDC.
  Regex `^(0|[1-9][0-9]*)$`. Never JSON numbers. Never floats.
- **Block numbers are decimal strings** (`"21000000"`).
- **Timestamps are ISO-8601 UTC with `Z`**, whole seconds, e.g. `"2026-10-18T21:30:00Z"`.
- **Addresses are EIP-55 checksummed** in responses (server normalizes with viem `getAddress`). Server accepts any case on input.
- Request ids: 22-char base62 `^[0-9A-Za-z]{22}$`. Split ids: same format.
- Unknown request-body fields → `400 invalid_input` (zod `.strict()`).
- Nullable fields are present with `null`, not omitted (responses). Optional input fields may be omitted.
- Auth: `POST /api/requests`, `/api/splits`, `/api/terms` require `Authorization: Bearer <TAB_PLUGIN_KEY>`.
  **PayBox injects this header** (brokered secret); the plugin never sets it. All GETs are public.
- Error body (any non-2xx):
  ```json
  { "error": { "code": "not_found", "message": "Request not found" } }
  ```
  `code` ∈ `invalid_input` (400) | `unauthorized` (401) | `not_found` (404) | `conflict` (409) | `rate_limited` (429) | `internal` (500/502/503).
- The plugin treats 5xx / 429 / timeouts / non-JSON as "API unreachable" and degrades (offline links, chain-only status). 4xx are surfaced to the agent.
- Responses must be < 256 KiB. CORS not required for plugin calls.

## Types

### `RequestStatus`
`"open" | "paid" | "expired" | "paid_late" | "checking"`
- `paid_late`: matched transfer happened after `expires_at` (still counts as paid).
- `checking`: the server could not complete the chain scan; never report "open" if unsure.

### `RequestRecord`
```json
{
  "id": "4fGh8Kq2LmN0pQrS7tUvWx",
  "split_id": null,
  "recipient": "0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E",
  "amount_atomic": "2000000",
  "unique_atomic": "2000417",
  "memo": "Dinner at Toit",
  "payer_label": "Meera",
  "requester_label": "Adwait",
  "created_at": "2026-10-18T01:00:00Z",
  "expires_at": "2026-10-25T01:00:00Z",
  "start_block": "52737334",
  "signature": null,
  "status": "open",
  "paid_tx": null,
  "paid_at": null,
  "payer_address": null
}
```
- `amount_atomic`: base amount requested. `unique_atomic = amount_atomic + s`, `s ∈ [1, 9999]`, unique among the
  recipient's **open** requests (DB constraint `unique(recipient, unique_atomic) where status='open'`).
- `memo` (≤140), `payer_label` (≤40), `requester_label` (≤40): untrusted user text, `null` when absent. Server strips
  control chars too and renders as text only.
- `signature`: EIP-191 `personal_sign` hex (see "Creator signature") or `null`.
- `payer_address`: payer if known (from a matched transfer's `from`), else `null`.

### `SplitRecord`
```json
{
  "id": "9aBcDeFgHiJkLmNoPqRsTu",
  "recipient": "0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E",
  "total_atomic": "6000000",
  "memo": "Dinner at Toit",
  "requester_label": "Adwait",
  "created_at": "2026-10-18T01:00:00Z"
}
```
`total_atomic` is the full bill (including the requester's own share and any tip).

## Endpoints

### `POST /api/requests` (Bearer)
Body:
```json
{
  "recipient": "0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E",
  "amount_atomic": "2000000",
  "memo": "Dinner at Toit",
  "payer_label": "Meera",
  "requester_label": "Adwait",
  "expires_at": "2026-10-25T01:00:00Z",
  "start_block": "52737334"
}
```
`memo`, `payer_label`, `requester_label` optional (omit or `null`). `start_block` = Base block number when the plugin
created the request (payment scans start there). Server validates `amount_atomic > 0`, `expires_at` in the future.
Response `201`: `RequestRecord` (status `"open"`).

### `POST /api/splits` (Bearer)
Creates the split row + N request rows in **one DB transaction**.
Body:
```json
{
  "recipient": "0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E",
  "total_atomic": "6000000",
  "memo": "Dinner at Toit",
  "requester_label": "Adwait",
  "expires_at": "2026-10-25T01:00:00Z",
  "start_block": "52737334",
  "requests": [
    { "payer_label": "Meera", "amount_atomic": "2000000" },
    { "payer_label": "Aarav", "amount_atomic": "2000000" }
  ]
}
```
`requests`: 1..20 items, each `amount_atomic > 0`; `payer_label` required (≤40). Sum of request amounts ≤ `total_atomic`
(the difference is the requester's own share). Each child request gets `split_id`, the split's `memo`,
`requester_label`, `expires_at`, `start_block`, and its own unique suffix.
Response `201`:
```json
{ "split": SplitRecord, "requests": [RequestRecord, ...] }
```
`requests` **in the same order as the body**.

### `POST /api/terms` (Bearer)
Stores deal/bet terms text by hash so pages can show it.
Body: `{ "hash": "0x<64 hex>", "body": "Logo design, 3 concepts, SVG + PNG" }` (`body` 1..1000 chars).
Server **must verify** `hash == keccak256(toBytes(body))` (viem `keccak256(stringToBytes(body))`, UTF-8) else `400`.
Idempotent: same hash again → `200`. New → `201`. Response: `{ "hash": "0x…", "created_at": "…Z" }`.

### `GET /api/requests/:id`
Response `200`: `RequestRecord`. `404` if unknown. `:id` may also be an offline payload id `p.<base64url>` — the server
may decode it (see "Offline links") and return a synthesized `RequestRecord` with `id` = the full `p.…` string, or `404`.

### `GET /api/requests/:id/status`
Response `200`:
```json
{
  "id": "4fGh8Kq2LmN0pQrS7tUvWx",
  "status": "paid",
  "paid_tx": "0x<64 hex>",
  "paid_at": "2026-10-18T01:05:12Z",
  "payer_address": "0xB7E0…400A3",
  "checked_at": "2026-10-18T01:05:15Z"
}
```
`paid_tx`, `paid_at`, `payer_address` are `null` unless status is `paid`/`paid_late`. The plugin re-verifies
`paid_tx` on-chain (receipt contains a USDC `Transfer(to=recipient, value=unique_atomic)` at block ≥ `start_block`).

### `GET /api/splits/:id`
Response `200`:
```json
{
  "split": SplitRecord,
  "requests": [RequestRecord, ...],
  "collected_atomic": "2000417",
  "outstanding_atomic": "2001288"
}
```
`collected_atomic` = Σ `unique_atomic` of paid/paid_late children; `outstanding_atomic` = Σ `unique_atomic` of the rest.

### `GET /api/addresses/:addr/tabs?status=open|all`
`status` default `open` (open = requests `open`/`checking`, deals not terminal, bets not terminal).
Response `200`:
```json
{
  "address": "0xBEFF…3D2E",
  "owed_to_you": [RequestRecord, ...],
  "you_owe": [RequestRecord, ...],
  "deals": [{ "id": "12", "role": "buyer", "state": "Funded" }],
  "bets": [{ "id": "3", "role": "creator", "state": "Open" }]
}
```
- `owed_to_you`: requests with `recipient == addr`. `you_owe`: requests with `payer_address == addr`.
- `deals`/`bets`: from the escrow indexer (`escrow_objects`), newest first, max 50 each. `id` decimal string.
  `role` ∈ deals: `buyer|seller|arbiter`; bets: `creator|opponent|arbiter`. `state` = the Solidity enum name
  (`Funded`, `Delivered`, `Released`, `Refunded`, `Disputed`, `Resolved` / `Open`, `Matched`, `Settled`, `Refunded`).
  The plugin re-reads each (≤10) from the contract.
- Max 100 requests per list, newest first.

### `GET /api/escrow/deals/:id`
Response `200` (decoded `getDeal(id)` + terms):
```json
{
  "id": "12",
  "buyer": "0x…", "seller": "0x…", "arbiter": null,
  "amount_atomic": "3000000",
  "deliver_by": "2026-10-20T12:00:00Z",
  "review_window_seconds": 172800,
  "delivered_at": null,
  "state": "Funded",
  "terms_hash": "0x…",
  "terms": "Logo design, 3 concepts" ,
  "created_tx": "0x…"
}
```
`arbiter`/`delivered_at`/`terms`/`created_tx` nullable (`address(0)` → `null`, `deliveredAt == 0` → `null`).

### `GET /api/escrow/bets/:id`
```json
{
  "id": "3",
  "kind": "Price",
  "creator": "0x…", "opponent": null, "arbiter": null,
  "stake_atomic": "2000000",
  "join_by": "2026-10-18T15:00:00Z",
  "resolve_at": "2026-10-18T15:30:00Z",
  "state": "Open",
  "feed": "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  "threshold": "400000000000",
  "feed_decimals": 8,
  "creator_above": true,
  "creator_report": null, "opponent_report": null,
  "terms_hash": "0x…",
  "terms": "ETH/USD >= 4000.00 at 2026-10-18T15:30:00Z",
  "created_tx": "0x…"
}
```
`kind` ∈ `Price|Mutual`. For Mutual, `feed`/`threshold`/`feed_decimals`/`creator_above` are `null`.
`threshold` is the raw int256 in feed decimals, decimal string.

## Links (pages)

`{TAB_API_BASE}/r/{requestId}`, `/s/{splitId}`, `/d/{dealId}`, `/b/{betId}`, and offline `/r/p.<base64url>`.

## Offline links (`/r/p.<payload>`)

Used by the plugin when the API is unreachable. Self-contained; pages must render them without the DB.

`payload` = base64url (RFC 4648 §5, **no padding**) of UTF-8 JSON with exactly these keys:
```json
{
  "v": 1,
  "r": "0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E",
  "a": "2000000",
  "u": "2000417",
  "c": 1792260000,
  "e": 1792864800,
  "b": "52737334",
  "n": "9f3a0c1d2b4e5f60",
  "m": "Dinner at Toit",
  "pl": "Meera",
  "rl": "Adwait",
  "h": "a1b2c3d4e5f6"
}
```
- `r` checksummed recipient; `a` base atomic; `u` unique atomic; `c` created_at unix seconds; `e` expires_at unix seconds;
  `b` start block; `n` 8-byte random nonce as 16 lowercase hex; `m`/`pl`/`rl` strings (`""` when absent).
- **Suffix rule:** `u = a + s`, `s = (uint256(keccak256(encodePacked(address r, uint256 a, uint64 c, bytes8 n))) mod 9999) + 1`.
  viem: `keccak256(encodePacked(["address","uint256","uint64","bytes8"], [r, BigInt(a), BigInt(c), "0x"+n]))`.
- **Checksum:** `h` = first 6 bytes (12 lowercase hex chars) of `keccak256(stringToBytes(JSON.stringify([v, r, a, u, c, e, b, n, m, pl, rl])))`.
- Decoders must reject: bad JSON, unknown/missing keys, `h` mismatch, suffix mismatch, non-checksummed `r`.
- This is **integrity against corruption, not authentication** — anyone can mint a valid payload. Pages must label
  payload-only requests "Unverified: confirm the address with the sender" unless a creator signature verifies.

## Creator signature (P1, R6)

EIP-191 `personal_sign` by `recipient` over exactly (LF line endings, no trailing newline):
```
Tab payment request
id: {id}
recipient: {recipient (checksummed)}
amount: {unique_atomic} USDC base units on Base
expires: {expires_at}
```
`POST /api/requests/:id/signature` `{ "signature": "0x…" }` (no auth) → server verifies with viem `verifyMessage`
(EOA) / `publicClient.verifyMessage` (smart accounts) that it recovers to `recipient`, then stores it. Plugin re-verifies.

## Payment matching (server and plugin use the same rule, PRD §11.3)

RPC `eth_getLogs` only (Blockscout is Cloudflare-blocked for servers): topic0 = Transfer, topic2 = recipient, USDC address,
≤2,000-block chunks, `mainnet.base.org` then `base-rpc.publicnode.com` (mainnet.base.org rejects getLogs with -32011, so
expect the fallback). Never scan below TabEscrow's deploy block **52737895**. Incomplete scan ⇒ `checking`, never `open`.
The plugin also verifies the API's `paid_tx` hint directly via `eth_getTransactionReceipt`.


Paid iff a USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) `Transfer(from=any, to=recipient, value=unique_atomic)`
exists at block ≥ `start_block`; earliest by (block, logIndex) wins. `paid_late` if its block timestamp > `expires_at`.
