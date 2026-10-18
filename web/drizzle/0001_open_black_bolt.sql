CREATE TABLE "page_views" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "page_views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"path" text NOT NULL,
	"country" text,
	"region" text,
	"city" text,
	"referrer_host" text,
	"utm_source" text,
	"device" text NOT NULL,
	"browser" text,
	"visitor" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "page_views_at_idx" ON "page_views" USING btree ("at");