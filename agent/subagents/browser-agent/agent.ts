import { defineAgent, defineDynamic } from "eve";
import { resolveModeValue } from "@agent/lib/mode";
import { catalogModelSelection } from "@agent/lib/models/selection";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { getModelId } from "@db/services/settings";
import { defaultModelIds } from "@shared/models/catalog";

export default defineDynamic(async (context) => {
  // This model reads whole web pages, so it is chosen separately from the
  // assistant's. eve requires a dynamic subagent's model to be static, so it
  // is resolved here for the session rather than per model call.
  const caller = context.session.auth.current ?? context.session.auth.initiator;
  const modelId = caller
    ? await getModelId(scopeFromPrincipal(caller), "browser")
    : defaultModelIds.browser;
  const worker = defineAgent({
    tool: false,
    description:
      "Execute one bounded browser assignment for the root coordinator, including secure vault autofill, transaction preparation, optional durable browser images, human-takeover handoff, cleanup, and a concise verified result.",
    ...catalogModelSelection(modelId, "browser"),
    reasoning: "low",
    compaction: {
      threshold: 0.7,
    },
  });
  return resolveModeValue(context, {
    interactive: worker,
    "scheduled-worker": worker,
  });
});
