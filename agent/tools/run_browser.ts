import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { taskCompletionSchema } from "@agent/subagents/browser-agent/lib/completion";

// eve's message when a worker answers without its completion tool. The worker
// already holds its findings then, so asking it to resend them is far cheaper
// than failing and having the coordinator repeat the whole browser run.
const unstructuredResult =
  "The agent could not produce a result matching the requested schema.";
const resendRequest =
  "Your last answer did not reach the coordinator because it was not sent with the completion tool. Send the result you already have with that tool now; do not repeat the browser work.";

export default defineWorkflowTool({
  description:
    "Execute one bounded browser assignment and return a verified result with optional private image artifacts. Pass taskId to continue an idle worker with its browser state and context. The completion schema is supplied automatically.",
  inputSchema: z.object({
    message: z.string().min(1),
  }),
  // Each task keeps one browser-agent session, so later calls with the same
  // taskId continue that worker instead of starting a fresh one.
  async serve(receive, ctx) {
    "use workflow";
    const worker = ctx.agent("browser-agent");
    // A plain JSON Schema stays serializable across workflow steps.
    const outputSchema = z
      .record(z.string(), z.json())
      .parse(z.toJSONSchema(taskCompletionSchema));
    /* oxlint-disable eslint/no-await-in-loop -- A serve task handles its calls one at a time, in order. */
    for (;;) {
      const { input, abortSignal } = await receive();
      try {
        const options = { outputSchema, signal: abortSignal };
        let result = await (await worker.send(input.message, options)).result();
        if (
          result.status === "failed" &&
          result.error.message === unstructuredResult
        ) {
          result = await (await worker.send(resendRequest, options)).result();
        }
        if (result.status === "failed") {
          ctx.reply(
            taskCompletionSchema.parse({
              images: [],
              message: `Browser worker failed: ${result.error.message}`,
              status: "failure",
            })
          );
          continue;
        }
        if (result.status === "cancelled") continue;
        ctx.reply(taskCompletionSchema.parse(result.data));
      } catch (error) {
        // A cancelled stretch returns to receive() so the worker stays available.
        if (!abortSignal.aborted) throw error;
      }
    }
    /* oxlint-enable eslint/no-await-in-loop */
  },
});
