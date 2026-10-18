import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const requestStatuses = ["open", "paid", "paid_late", "expired"] as const;
export type StoredRequestStatus = (typeof requestStatuses)[number];

export const requests = pgTable(
  "requests",
  {
    id: text("id").primaryKey(),
    splitId: text("split_id"),
    splitIndex: integer("split_index"),
    recipient: text("recipient").notNull(),
    amountAtomic: numeric("amount_atomic", { precision: 30, scale: 0 }).notNull(),
    uniqueAtomic: numeric("unique_atomic", { precision: 30, scale: 0 }).notNull(),
    memo: text("memo"),
    payerLabel: text("payer_label"),
    requesterLabel: text("requester_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    startBlock: bigint("start_block", { mode: "bigint" }).notNull(),
    // Highest block fully scanned for a matching transfer, so slow scans resume instead of restarting.
    scannedBlock: bigint("scanned_block", { mode: "bigint" }),
    signature: text("signature"),
    status: text("status", { enum: requestStatuses }).notNull().default("open"),
    paidTx: text("paid_tx"),
    paidLogIndex: integer("paid_log_index"),
    paidBlock: bigint("paid_block", { mode: "bigint" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    payerAddress: text("payer_address"),
  },
  (t) => [
    uniqueIndex("requests_open_unique_amount")
      .on(t.recipient, t.uniqueAtomic)
      .where(sql`${t.status} = 'open'`),
    uniqueIndex("requests_paid_transfer").on(t.paidTx, t.paidLogIndex).where(sql`${t.paidTx} is not null`),
    index("requests_recipient_idx").on(t.recipient, t.createdAt),
    index("requests_payer_idx").on(t.payerAddress, t.createdAt),
    index("requests_split_idx").on(t.splitId),
  ],
);

export const splits = pgTable("splits", {
  id: text("id").primaryKey(),
  recipient: text("recipient").notNull(),
  totalAtomic: numeric("total_atomic", { precision: 30, scale: 0 }).notNull(),
  memo: text("memo"),
  requesterLabel: text("requester_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const terms = pgTable("terms", {
  hash: text("hash").primaryKey(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chainCursor = pgTable("chain_cursor", {
  name: text("name").primaryKey(),
  block: bigint("block", { mode: "bigint" }).notNull(),
});

export const escrowKinds = ["deal", "bet"] as const;
export type EscrowKind = (typeof escrowKinds)[number];

export interface EscrowObjectData {
  createdTx?: string;
  buyer?: string;
  seller?: string;
  arbiter?: string;
  creator?: string;
  opponent?: string;
  winner?: string;
  payout?: string;
  price?: string;
  lastTx?: string;
}

export const escrowObjects = pgTable(
  "escrow_objects",
  {
    kind: text("kind", { enum: escrowKinds }).notNull(),
    id: bigint("id", { mode: "bigint" }).notNull(),
    participants: text("participants").array().notNull(),
    state: text("state").notNull(),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull(),
    data: jsonb("data").$type<EscrowObjectData>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.id] }),
    index("escrow_objects_participants_idx").using("gin", t.participants),
  ],
);

export const schema = { requests, splits, terms, chainCursor, escrowObjects };
export type RequestRow = typeof requests.$inferSelect;
export type SplitRow = typeof splits.$inferSelect;
export type EscrowObjectRow = typeof escrowObjects.$inferSelect;

// Privacy-preserving page views: no IPs or user ids stored. `visitor` is a salted hash
// that rotates daily, so it counts unique visitors per day without tracking anyone across days.
export const pageViews = pgTable(
  "page_views",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    path: text("path").notNull(),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    device: text("device", { enum: ["mobile", "tablet", "desktop"] }).notNull(),
    browser: text("browser"),
    visitor: text("visitor").notNull(),
  },
  (t) => [index("page_views_at_idx").on(t.at)],
);
