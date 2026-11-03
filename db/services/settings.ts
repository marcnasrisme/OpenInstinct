import { and, eq } from "drizzle-orm";
import type { AccessScope } from "@shared/identity/access-scope";
import { defaultModelIds, type ModelRole } from "@shared/models/catalog";
import { db, settings } from "@db";

// The assistant keeps its original key so existing workspace choices carry over.
const modelSettingKeys = {
  assistant: "gateway_model",
  browser: "browser_model",
} as const satisfies Record<ModelRole, string>;

async function readSetting(
  scope: AccessScope,
  key: (typeof modelSettingKeys)[ModelRole]
) {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(
      and(eq(settings.workspaceId, scope.workspaceId), eq(settings.key, key))
    )
    .limit(1);
  return rows[0]?.value;
}

export async function getModelId(scope: AccessScope, role: ModelRole) {
  return (
    (await readSetting(scope, modelSettingKeys[role])) ?? defaultModelIds[role]
  );
}

export async function selectModelId(
  scope: AccessScope,
  role: ModelRole,
  modelId: string
) {
  await db
    .insert(settings)
    .values({
      key: modelSettingKeys[role],
      value: modelId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: [settings.workspaceId, settings.key],
      set: { value: modelId },
    });
}
