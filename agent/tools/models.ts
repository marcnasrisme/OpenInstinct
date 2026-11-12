import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@agent/lib/mode";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { getModelId, selectModelId } from "@db/services/settings";
import {
  availableModels,
  catalogModel,
  modelCatalog,
  modelRoles,
} from "@shared/models/catalog";

// The same choice as the workspace page's model selectors, so the user can
// switch models by text, for example to compare browser models.
export const chooseModel = defineTool({
  description:
    "Show or change the model behind the assistant or the browser worker for the user's workspace, the same setting as the workspace page. Use it when the user asks which model you use or tells you to switch. Omit modelId to report the current model and the options for that role. A new assistant model applies from your next step, and a new browser model from the next browser task.",
  inputSchema: z.object({
    modelId: z
      .string()
      .optional()
      .describe(
        `The catalog ID to switch to: ${modelCatalog.map(({ id, label }) => `${id} (${label})`).join(", ")}.`
      ),
    role: z.enum(modelRoles),
  }),
  async execute({ modelId, role }, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (!caller) {
      throw new Error("Choosing a model requires an authenticated user.");
    }
    const scope = scopeFromPrincipal(caller);
    const options = availableModels(role).map(({ id, label }) => ({
      id,
      label,
    }));
    if (modelId !== undefined) {
      if (!options.some(({ id }) => id === modelId)) {
        throw new Error(
          `${modelId} can't run the ${role}. Choose one of: ${options.map(({ id }) => id).join(", ")}.`
        );
      }
      await selectModelId(scope, role, modelId);
    }
    const current = await getModelId(scope, role);
    return {
      current: { id: current, label: catalogModel(current)?.label ?? current },
      options,
      role,
    };
  },
});

export default defineDynamic((context) =>
  resolveModeValue(context, {
    interactive: { choose_model: chooseModel },
  })
);
