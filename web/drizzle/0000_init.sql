CREATE TABLE "chain_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_objects" (
	"kind" text NOT NULL,
	"id" bigint NOT NULL,
	"participants" text[] NOT NULL,
	"state" text NOT NULL,
	"updated_block" bigint NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "escrow_objects_kind_id_pk" PRIMARY KEY("kind","id")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"split_id" text,
	"split_index" integer,
	"recipient" text NOT NULL,
	"amount_atomic" numeric(30, 0) NOT NULL,
	"unique_atomic" numeric(30, 0) NOT NULL,
	"memo" text,
	"payer_label" text,
	"requester_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"start_block" bigint NOT NULL,
	"scanned_block" bigint,
	"signature" text,
	"status" text DEFAULT 'open' NOT NULL,
	"paid_tx" text,
	"paid_log_index" integer,
	"paid_block" bigint,
	"paid_at" timestamp with time zone,
	"payer_address" text
);
--> statement-breakpoint
CREATE TABLE "splits" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"total_atomic" numeric(30, 0) NOT NULL,
	"memo" text,
	"requester_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"hash" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "escrow_objects_participants_idx" ON "escrow_objects" USING gin ("participants");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_open_unique_amount" ON "requests" USING btree ("recipient","unique_atomic") WHERE "requests"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "requests_paid_transfer" ON "requests" USING btree ("paid_tx","paid_log_index") WHERE "requests"."paid_tx" is not null;--> statement-breakpoint
CREATE INDEX "requests_recipient_idx" ON "requests" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "requests_payer_idx" ON "requests" USING btree ("payer_address","created_at");--> statement-breakpoint
CREATE INDEX "requests_split_idx" ON "requests" USING btree ("split_id");