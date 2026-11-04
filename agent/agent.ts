import { defineAgent, defineDynamic } from "eve";
import { scheduledRunIdentity } from "@agent/lib/schedules/identity";
import { isScheduledAgentRunLeaseActive } from "@db/services/scheduled-agent-run-leases";
import { selectedModel } from "@agent/lib/models/selection";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";

export default defineAgent({
  build: {
    // Loaded at runtime from node_modules: the browser-agent's Browser Loop
    // tools, and the image renderer, whose WebAssembly and font files must
    // ship as files rather than be bundled.
    externalDependencies: ["@onkernel/browser-loop", "@vercel/og"],
  },
  defaultTools: false,
  // eve resolves this before every model call, so the lease is rechecked per step.
  model: defineDynamic(async (ctx) => {
    const scheduledRun = scheduledRunIdentity(ctx.session.auth);
    if (
      scheduledRun &&
      !(await isScheduledAgentRunLeaseActive(
        scheduledRun.runId,
        scheduledRun.leaseToken
      ))
    ) {
      throw new Error("The scheduled run lease is no longer active.");
    }
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    return selectedModel(scopeFromPrincipal(caller), "assistant");
  }),
  reasoning: "low",
  compaction: {
    threshold: 0.7,
  },
});
