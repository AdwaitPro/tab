export const DEAL_STATES = ["None", "Funded", "Delivered", "Released", "Refunded", "Disputed", "Resolved"] as const;
export type DealState = (typeof DEAL_STATES)[number];
export const BET_STATES = ["None", "Open", "Matched", "Settled", "Refunded"] as const;
export type BetState = (typeof BET_STATES)[number];
export const BET_KINDS = ["Price", "Mutual"] as const;
export type BetKind = (typeof BET_KINDS)[number];

export const TERMINAL_DEAL_STATES: readonly DealState[] = ["Released", "Refunded", "Resolved"];
export const TERMINAL_BET_STATES: readonly BetState[] = ["Settled", "Refunded"];

/** Contract constants (TabEscrow.sol), in seconds. */
export const DISPUTE_TIMEOUT_S = 30 * 24 * 3600;
export const PRICE_REFUND_DELAY_S = 3 * 24 * 3600;
export const MUTUAL_REFUND_DELAY_S = 7 * 24 * 3600;
export const ARBITRATION_GRACE_S = 2 * 24 * 3600;

export interface DealRecord {
  id: string;
  buyer: string;
  seller: string;
  arbiter: string | null;
  amount_atomic: string;
  deliver_by: string;
  review_window_seconds: number;
  delivered_at: string | null;
  disputed_at: string | null;
  state: DealState;
  terms_hash: string;
  terms: string | null;
  created_tx: string | null;
}

export interface BetRecord {
  id: string;
  kind: BetKind;
  creator: string;
  opponent: string | null;
  arbiter: string | null;
  stake_atomic: string;
  join_by: string;
  resolve_at: string;
  state: BetState;
  feed: string | null;
  threshold: string | null;
  feed_decimals: number | null;
  creator_above: boolean | null;
  creator_report: string | null;
  opponent_report: string | null;
  terms_hash: string;
  terms: string | null;
  created_tx: string | null;
  /** Web-only extras (not part of the plugin contract). */
  winner: string | null;
  settled_price: string | null;
}

export interface PriceQuote {
  feed: string;
  description: string;
  answer: string;
  decimals: number;
  updated_at: string;
  /** Recent rounds, oldest first, for the live chart. */
  history: Array<{ answer: string; updated_at: string }>;
}
