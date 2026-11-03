CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"root_session_id" text,
	"call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"phase" text NOT NULL,
	"outcome" text,
	"cleared_by" jsonb,
	"interaction_id" text,
	"actor" text,
	"summary" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_call_phase_idx" ON "audit_events" USING btree ("call_id","phase");--> statement-breakpoint
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_change" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_append_only"();
