import { createHash } from "node:crypto";
import type { JsonValue } from "eve/events";
import { z } from "zod";
import { calendarEventSchema } from "@agent/lib/google-workspace/calendar";
import { gmailSendSchema } from "@agent/lib/google-workspace/gmail";

const vaultFillInputSchema = z.object({
  candidateId: z.string(),
  declaredTotal: z
    .object({ amountMinor: z.number(), currency: z.string() })
    .optional(),
  expectedOrigin: z.string(),
});

export type AuditSummary = Readonly<Record<string, JsonValue>>;

export function gmailSendAuditSummary(email: z.output<typeof gmailSendSchema>) {
  return {
    bcc: email.bcc,
    bodyLength: email.body.length,
    bodySha256: createHash("sha256").update(email.body).digest("hex"),
    cc: email.cc,
    subject: email.subject,
    to: email.to,
  } satisfies AuditSummary;
}

export function calendarEventAuditSummary(
  event: z.output<typeof calendarEventSchema>
) {
  return {
    attendees: event.attendees,
    end: event.end,
    start: event.start,
    summary: event.summary,
    timezone: event.timezone,
  } satisfies AuditSummary;
}

export function vaultFillAuditSummary(
  fill: z.output<typeof vaultFillInputSchema>
) {
  return {
    candidateId: fill.candidateId,
    declaredTotal: fill.declaredTotal
      ? {
          amountMinor: fill.declaredTotal.amountMinor,
          currency: fill.declaredTotal.currency,
        }
      : null,
    expectedOrigin: fill.expectedOrigin,
  } satisfies AuditSummary;
}

// What the audit log keeps about a call seen in the session view. Only tools
// listed here record any input, and only their summary fields: a new tool
// records its name alone until it is added, so a vault value or message body
// can never reach the log.
export function auditSummary(
  toolName: string,
  input: JsonValue | undefined
): AuditSummary {
  switch (toolName) {
    case "gmail-send": {
      const email = gmailSendSchema.safeParse(input);
      return email.success ? gmailSendAuditSummary(email.data) : {};
    }
    case "calendar-create-event": {
      const event = calendarEventSchema.safeParse(input);
      return event.success ? calendarEventAuditSummary(event.data) : {};
    }
    case "fill_from_vault": {
      const fill = vaultFillInputSchema.safeParse(input);
      return fill.success ? vaultFillAuditSummary(fill.data) : {};
    }
    default:
      return {};
  }
}
