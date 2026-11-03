CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_sha256" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"label" text NOT NULL,
	"line_phone_number" text NOT NULL,
	"phone_number" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"claimed_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_idx" ON "invites" USING btree ("token_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_line_active_idx" ON "invites" USING btree ("line_phone_number") WHERE "invites"."status" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "invites_phone_active_idx" ON "invites" USING btree ("phone_number") WHERE "invites"."status" <> 'revoked';