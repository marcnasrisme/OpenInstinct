import { afterEach, describe, expect, it, vi } from "vitest";

const scope = { userId: "user-1", workspaceId: "workspace-1" };

const serverVariables = [
  "OPENAI_COMPATIBLE_API_KEY",
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_COMPATIBLE_CONTEXT_TOKENS",
  "OPENAI_COMPATIBLE_MODEL",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// Loads model selection with a stored model ID and fresh environment, since
// the environment is validated once at import.
async function selectionFor(
  modelId: string,
  environment: Partial<Record<(typeof serverVariables)[number], string>> = {}
) {
  vi.resetModules();
  for (const name of serverVariables) {
    vi.stubEnv(name, environment[name] ?? "");
  }
  const settings = await import("@db/services/settings");
  const getModelId = vi
    .spyOn(settings, "getModelId")
    .mockResolvedValue(modelId);
  const { selectedModel } = await import("@agent/lib/models/selection");
  return { getModelId, selectedModel };
}

describe("model selection", () => {
  it("routes a catalog gateway model by its ID", async () => {
    const { getModelId, selectedModel } = await selectionFor(
      "openai/gpt-6.1-sol-fast"
    );

    await expect(selectedModel(scope, "assistant")).resolves.toEqual({
      model: "openai/gpt-6.1-sol-fast",
    });
    expect(getModelId).toHaveBeenCalledWith(scope, "assistant");
  });

  it("fails visibly for a model outside the catalog", async () => {
    const { selectedModel } = await selectionFor("openai/some-other-model");

    await expect(selectedModel(scope, "assistant")).rejects.toThrow(
      'The assistant model "openai/some-other-model" is not in the model catalog.'
    );
  });

  it("fails visibly for a catalog model used in the wrong role", async () => {
    const { selectedModel } = await selectionFor("meta/muse-spark-1.3");

    await expect(selectedModel(scope, "assistant")).rejects.toThrow(
      "is not in the model catalog"
    );
  });

  it("requires a configured server for the self-hosted model", async () => {
    const { selectedModel } = await selectionFor("openai-compatible");

    await expect(selectedModel(scope, "browser")).rejects.toThrow(
      "Set OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL"
    );
  });

  it("builds an OpenAI-compatible model with its context window", async () => {
    const { selectedModel } = await selectionFor("openai-compatible", {
      OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1",
      OPENAI_COMPATIBLE_CONTEXT_TOKENS: "32000",
      OPENAI_COMPATIBLE_MODEL: "gpt-oss:20b",
    });

    await expect(selectedModel(scope, "assistant")).resolves.toMatchObject({
      model: { modelId: "gpt-oss:20b" },
      modelContextWindowTokens: 32_000,
    });
  });
});
