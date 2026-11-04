import {
  calls,
  type CapabilityKind,
  type ContentCompleted,
  type ErrorInfo,
  runs,
  turn,
  turns,
  usage,
  type ObservationTiming,
  type SessionEnded,
  type TurnSettled,
  type Usage,
} from "eve/events";
import type { HookContext } from "eve/hooks";
import { createLogger, initLogger } from "evlog";

// evlog's eve hook (evlog/eve) still reads v26 session events, which eve 1.0
// no longer emits. These handlers keep the same per-turn wide event from v27
// events until evlog ships an eve 1.0 integration. They log tool names,
// outcomes, timings, and usage only: message text would land in platform logs,
// which keep it on the hosting provider's retention terms.
let loggerInitialized = false;

function logger(context: Parameters<typeof createLogger>[0]) {
  if (!loggerInitialized) {
    initLogger({ env: { service: "open-instinct" }, redact: false });
    loggerInitialized = true;
  }
  return createLogger(context);
}

function channelKind(ctx: Pick<HookContext, "channel">) {
  return ctx.channel.kind.replace(/^channel:/, "");
}

function seconds(from: string | undefined, to: string | undefined) {
  if (!from || !to) return undefined;
  return Math.round((Date.parse(to) - Date.parse(from)) / 100) / 10;
}

// When a step started, counted from the turn's start, and how long it took, so
// one line shows where a slow turn spent its time.
function timed<Fields extends object>(
  step: ObservationTiming,
  turnStartedAt: string | undefined,
  fields: Fields
) {
  return {
    ...fields,
    at: seconds(turnStartedAt, step.startedAt),
    seconds: seconds(step.startedAt, step.endedAt),
  };
}

// Each usage record belongs to one model run or one call, so their sum is the
// turn's cost.
function turnCost(steps: readonly { readonly usage?: Usage }[]) {
  const total = steps.reduce(
    (sum, step) => sum + (step.usage?.costUsd ?? 0),
    0
  );
  return Math.round(total * 10_000) / 10_000;
}

function logTurn(
  ctx: HookContext,
  turnId: string,
  outcome: string,
  error?: ErrorInfo
) {
  try {
    const startedAt = turn(ctx.view, turnId)?.startedAt;
    const models = runs(ctx.view, { turnId });
    const steps = calls(ctx.view, { turnId });
    const stepsOfKind = (kind: CapabilityKind) =>
      steps
        .filter((call) => call.kind === kind)
        .map((call) =>
          timed(call, startedAt, {
            name: call.name,
            outcome: call.outcome ?? call.state,
          })
        );
    const log = logger({
      agent: { name: ctx.agent.name },
      channel: { kind: channelKind(ctx) },
      models: models.map((run) =>
        timed(run, startedAt, { model: run.modelId })
      ),
      // Matches the evlog.request_id that agent/instrumentation/evlog.ts
      // puts on this turn's model-call spans.
      requestId: `${ctx.session.id}:${turnId}`,
      session: { id: ctx.session.id, usage: usage(ctx.view).total },
      skills: stepsOfKind("skill"),
      tools: stepsOfKind("tool"),
      turn: {
        costUsd: turnCost([...models, ...steps]),
        id: turnId,
        outcome,
        seconds: seconds(startedAt, ctx.now.toISOString()),
      },
    });
    if (outcome === "failed") {
      log.error(error?.message ?? "The turn failed.");
    }
    log.emit();
  } catch (caught) {
    // Telemetry must never fail the turn.
    console.warn("[evlog] turn event failed", { cause: caught });
  }
}

export function logTurnSettled(event: TurnSettled, ctx: HookContext) {
  logTurn(ctx, event.data.turnId, event.data.outcome, event.data.error);
}

// A browser worker's assignment ends with its structured result, which is
// also where its trace records completion, so its timings are logged there.
export function logWorkerResult(event: ContentCompleted, ctx: HookContext) {
  const turnId = event.scope?.turnId;
  if (event.data.kind !== "result" || !turnId) return;
  logTurn(ctx, turnId, "completed");
}

export function logSessionEnded(event: SessionEnded, ctx: HookContext) {
  try {
    const log = logger({
      agent: { name: ctx.agent.name },
      channel: { kind: channelKind(ctx) },
      requestId: ctx.session.id,
      session: {
        id: ctx.session.id,
        outcome: event.data.outcome,
        turns: turns(ctx.view).length,
      },
      usage: usage(ctx.view).total,
    });
    if (event.data.outcome === "failed") {
      log.error(event.data.error?.message ?? "The session failed.");
    }
    log.emit();
  } catch (error) {
    console.warn("[evlog] session event failed", { cause: error });
  }
}
