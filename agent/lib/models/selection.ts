import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getModelId } from "@db/services/settings";
import { env } from "@shared/environment";
import type { AccessScope } from "@shared/identity/access-scope";
import { catalogModel, type ModelRole } from "@shared/models/catalog";

// Turns a catalog model ID into eve's model fields. A model outside the
// catalog, or a self-hosted server that is not configured, fails the turn
// instead of quietly switching to another model.
export function catalogModelSelection(modelId: string, role: ModelRole) {
  const model = catalogModel(modelId);
  if (!model?.roles.includes(role)) {
    throw new Error(
      `The ${role} model "${modelId}" is not in the model catalog. Choose a model in the workspace.`
    );
  }

  if (model.route.kind === "gateway") {
    return model.route.zeroDataRetention
      ? {
          model: model.route.model,
          modelOptions: {
            providerOptions: { gateway: { zeroDataRetention: true } },
          },
        }
      : { model: model.route.model };
  }

  const baseURL = env.OPENAI_COMPATIBLE_BASE_URL;
  const providerModel = env.OPENAI_COMPATIBLE_MODEL;
  if (!baseURL || !providerModel) {
    throw new Error(
      "Set OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL to use your own model server."
    );
  }
  const provider = createOpenAICompatible({
    apiKey: env.OPENAI_COMPATIBLE_API_KEY,
    baseURL,
    includeUsage: true,
    name: "openai-compatible",
  });
  return {
    model: provider(providerModel),
    modelContextWindowTokens: env.OPENAI_COMPATIBLE_CONTEXT_TOKENS,
  };
}

export async function selectedModel(scope: AccessScope, role: ModelRole) {
  return catalogModelSelection(await getModelId(scope, role), role);
}
