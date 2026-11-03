import type { AccessScope } from "@shared/identity/access-scope";
import { auditEvents, db } from "@db";

type AuditEventInsert = typeof auditEvents.$inferInsert;

export type AuditEventRecord = Omit<
  AuditEventInsert,
  "createdAt" | "id" | "workspaceId"
>;

// The only writer for audit_events. Hooks can replay events, so a repeated
// (call, phase) is ignored instead of duplicated.
export async function recordAuditEvent(
  scope: AccessScope,
  event: AuditEventRecord
) {
  await db
    .insert(auditEvents)
    .values({ ...event, workspaceId: scope.workspaceId })
    .onConflictDoNothing({ target: [auditEvents.callId, auditEvents.phase] });
}
