import {
  call,
  interaction,
  type CallSettled,
  type CallStarted,
  type InteractionOpened,
  type InteractionSettled,
} from "eve/events";
import type { HookContext } from "eve/hooks";
import type { ToolContext } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { auditSummary, type AuditSummary } from "@agent/lib/audit/summary";
import { recordAuditEvent, type AuditEventRecord } from "@db/services/audit";

type AuditedSession = Pick<HookContext, "session">;

const chosenOptionSchema = z.object({ optionId: z.string() });

// Writes one audit row for the caller's workspace. Errors propagate: a hook
// that cannot record fails the turn before its next step, and a gated tool
// that cannot record its intent does not act.
async function record(
  ctx: AuditedSession,
  event: Omit<AuditEventRecord, "actor" | "rootSessionId" | "sessionId">
) {
  const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
  if (!caller) return;
  await recordAuditEvent(scopeFromPrincipal(caller), {
    ...event,
    actor: caller.principalId,
    rootSessionId: ctx.session.parent?.rootSessionId ?? null,
    sessionId: ctx.session.id,
  });
}

// Called by a gated tool immediately before its side effect, so the action is
// on record even if the hooks for this call never run.
export async function recordToolIntent(
  ctx: ToolContext,
  toolName: string,
  summary: AuditSummary
) {
  if (!(ctx.session.auth.current ?? ctx.session.auth.initiator)) {
    throw new Error("An authenticated user is required to act.");
  }
  await record(ctx, {
    callId: ctx.callId,
    phase: "intent",
    summary,
    toolName,
  });
}

export async function auditCallStarted(event: CallStarted, ctx: HookContext) {
  const started = call(ctx.view, event.data.callId);
  if (started?.kind !== "tool") return;
  const { clearedBy } = event.data;
  await record(ctx, {
    callId: started.callId,
    clearedBy: clearedBy ?? null,
    interactionId:
      clearedBy && "interactionId" in clearedBy
        ? clearedBy.interactionId
        : null,
    phase: "started",
    summary: auditSummary(started.name, started.input),
    toolName: started.name,
  });
}

export async function auditCallSettled(event: CallSettled, ctx: HookContext) {
  const settled = call(ctx.view, event.data.callId);
  if (settled?.kind !== "tool") return;
  await record(ctx, {
    callId: settled.callId,
    outcome: event.data.outcome,
    phase: "settled",
    summary: {},
    toolName: settled.name,
  });
}

export async function auditApprovalOpened(
  event: InteractionOpened,
  ctx: HookContext
) {
  // A relayed request is the child's own approval; the child's hook records it.
  if (event.data.request.kind !== "approval" || event.data.origin) return;
  const requested = interaction(ctx.view, event.data.interactionId)?.call;
  if (!requested) return;
  await record(ctx, {
    callId: requested.callId,
    interactionId: event.data.interactionId,
    phase: "approval_opened",
    summary: auditSummary(requested.name, requested.input),
    toolName: requested.name,
  });
}

export async function auditApprovalAnswered(
  event: InteractionSettled,
  ctx: HookContext
) {
  const answered = interaction(ctx.view, event.data.interactionId);
  if (answered?.request.kind !== "approval" || !answered.call) return;
  await record(ctx, {
    callId: answered.call.callId,
    interactionId: event.data.interactionId,
    // The chosen option, never the free text a person typed with a denial.
    outcome:
      chosenOptionSchema.safeParse(event.data.response).data?.optionId ??
      answered.answer?.optionId ??
      event.data.outcome,
    phase: "approval_answered",
    summary: {},
    toolName: answered.call.name,
  });
}
