CREATE TABLE "browser_vault_fills" (
	"browser_session_id" text NOT NULL,
	"vault_item_id" text NOT NULL,
	"filled_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_vault_fills_pkey" PRIMARY KEY("browser_session_id","vault_item_id")
);
--> statement-breakpoint
ALTER TABLE "browser_vault_fills" ADD CONSTRAINT "browser_vault_fills_session_fkey" FOREIGN KEY ("browser_session_id") REFERENCES "public"."browser_sessions"("session_id") ON DELETE cascade ON UPDATE no action;