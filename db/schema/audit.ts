import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const auditEventPhases = [
  "intent",
  "approval_opened",
  "approval_answered",
  "started",
  "settled",
] as const;

// An append-only record of tool calls: what was asked, who approved it, and
// how it ended. A database trigger refuses UPDATE, DELETE, and TRUNCATE, and
// workspace_id has no foreign key, so deleting a workspace never cascades here.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sessionId: text("session_id").notNull(),
    rootSessionId: text("root_session_id"),
    callId: text("call_id").notNull(),
    toolName: text("tool_name").notNull(),
    phase: text("phase", { enum: auditEventPhases }).notNull(),
    outcome: text("outcome"),
    clearedBy: jsonb("cleared_by"),
    interactionId: text("interaction_id"),
    actor: text("actor"),
    // A per-tool allowlist of safe fields, never a raw input dump.
    summary: jsonb("summary").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("audit_events_call_phase_idx").on(table.callId, table.phase),
    index("audit_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt.desc()
    ),
  ]
);
