import { env } from "@shared/environment";

export const modelRoles = ["assistant", "browser"] as const;
export type ModelRole = (typeof modelRoles)[number];

// What the model's provider keeps. A reviewed entry names its source and the
// day it was checked; the catalog test fails once a review is 180 days old.
type RetentionTerms =
  | { readonly reviewed: false; readonly note: string }
  | {
      readonly reviewed: true;
      readonly note: string;
      readonly source: string;
      readonly checkedOn: string;
    };

interface CatalogModel {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly roles: readonly ModelRole[];
  readonly route:
    | {
        readonly kind: "gateway";
        readonly model: string;
        // Routes only through providers with a zero data retention agreement
        // with Vercel AI Gateway; requests fail when none is available.
        readonly zeroDataRetention: boolean;
      }
    | { readonly kind: "openai-compatible" };
  readonly retention: RetentionTerms;
}

// The only models the agent may use. Add an entry to allow a model: a Vercel
// AI Gateway model ID, or your own OpenAI-compatible server (Ollama, LM
// Studio, vLLM, OpenRouter, and others) configured by OPENAI_COMPATIBLE_*.
export const modelCatalog = [
  {
    id: "openai/gpt-6.1-sol-fast",
    label: "GPT-6.1 Sol Fast",
    provider: "OpenAI",
    retention: {
      note: "Through Vercel AI Gateway. OpenAI's retention terms apply and have not been reviewed.",
      reviewed: false,
    },
    roles: ["assistant"],
    route: {
      kind: "gateway",
      model: "openai/gpt-6.1-sol-fast",
      zeroDataRetention: false,
    },
  },
  {
    id: "meta/muse-spark-1.3",
    label: "Muse Spark 1.3",
    provider: "Meta",
    retention: {
      note: "Through Vercel AI Gateway. Meta's retention terms apply and have not been reviewed. This model sees whole web pages.",
      reviewed: false,
    },
    roles: ["browser"],
    route: {
      kind: "gateway",
      model: "meta/muse-spark-1.3",
      zeroDataRetention: false,
    },
  },
  {
    id: "openai-compatible",
    label: "Your OpenAI-compatible server",
    provider: "Self-hosted",
    retention: {
      note: "Set by the server at OPENAI_COMPATIBLE_BASE_URL. A model on your own machine sends nothing to a third party.",
      reviewed: false,
    },
    roles: ["assistant", "browser"],
    route: { kind: "openai-compatible" },
  },
] as const satisfies readonly CatalogModel[];

export const defaultModelIds = {
  assistant: "openai/gpt-6.1-sol-fast",
  browser: "meta/muse-spark-1.3",
} as const satisfies Record<ModelRole, (typeof modelCatalog)[number]["id"]>;

export function catalogModel(id: string): CatalogModel | undefined {
  return modelCatalog.find((model) => model.id === id);
}

// Models this deployment can use for a role; a self-hosted server counts
// only once its address and model name are configured.
export function availableModels(role: ModelRole): readonly CatalogModel[] {
  return modelCatalog.filter(
    (model: CatalogModel) =>
      model.roles.includes(role) &&
      (model.route.kind === "gateway" ||
        (env.OPENAI_COMPATIBLE_BASE_URL !== undefined &&
          env.OPENAI_COMPATIBLE_MODEL !== undefined))
  );
}
