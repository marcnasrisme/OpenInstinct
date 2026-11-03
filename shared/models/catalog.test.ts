import { describe, expect, it } from "vitest";
import {
  availableModels,
  catalogModel,
  defaultModelIds,
  modelCatalog,
  modelRoles,
} from "@shared/models/catalog";

const maximumReviewAgeDays = 180;

describe("model catalog", () => {
  it("lists each model once with a provider and retention terms", () => {
    const ids = modelCatalog.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of modelCatalog) {
      expect(model.provider).not.toBe("");
      expect(model.retention.note).not.toBe("");
      expect(model.roles.length).toBeGreaterThan(0);
    }
  });

  it("keeps every retention review sourced and recent", () => {
    for (const { id } of modelCatalog) {
      const retention = catalogModel(id)?.retention;
      if (!retention?.reviewed) continue;
      expect(new URL(retention.source).protocol).toBe("https:");
      const ageDays =
        (Date.now() - new Date(retention.checkedOn).getTime()) / 86_400_000;
      expect(
        ageDays,
        `${id} retention was checked ${retention.checkedOn}; review it again`
      ).toBeLessThanOrEqual(maximumReviewAgeDays);
    }
  });

  it("defaults each role to an available catalog model for that role", () => {
    for (const role of modelRoles) {
      const model = catalogModel(defaultModelIds[role]);
      expect(model?.roles).toContain(role);
      expect(availableModels(role).map(({ id }) => id)).toContain(
        defaultModelIds[role]
      );
    }
  });

  it("offers a self-hosted server only once it is configured", () => {
    expect(availableModels("assistant").map(({ id }) => id)).not.toContain(
      "openai-compatible"
    );
  });
});
