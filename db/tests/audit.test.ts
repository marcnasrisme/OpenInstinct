import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("audit events", () => {
  it("keeps one row per call phase and refuses edits, deletes, and truncation", async () => {
    const client = new PGlite();
    databases.push(client);
    const migration = await readFile(
      new URL("../migrations/0016_fixed_stingray.sql", import.meta.url),
      "utf8"
    );
    /* oxlint-disable eslint/no-await-in-loop -- SQL migration statements must execute in file order. */
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
    /* oxlint-enable eslint/no-await-in-loop */
    // SAFETY: PGlite implements the query-builder surface exercised by this service despite using a different Drizzle driver.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test swaps only the driver while retaining the shared Drizzle schema and query-builder contract.
    const database = drizzle(client, { schema }) as never;
    vi.spyOn(Database, "db", "get").mockReturnValue(database);
    const { recordAuditEvent } = await import("@db/services/audit");
    const scope = { userId: "user-1", workspaceId: "workspace-1" };
    const event = {
      actor: "better-auth:user-1",
      callId: "call-1",
      phase: "intent" as const,
      rootSessionId: null,
      sessionId: "session-1",
      summary: { to: ["bob@example.com"] },
      toolName: "gmail-send",
    };

    await recordAuditEvent(scope, event);
    await recordAuditEvent(scope, event);
    await recordAuditEvent(scope, { ...event, phase: "settled" });

    const rows = await client.query<{ phase: string; workspace_id: string }>(
      "select phase, workspace_id from audit_events order by phase"
    );
    expect(rows.rows).toEqual([
      { phase: "intent", workspace_id: "workspace-1" },
      { phase: "settled", workspace_id: "workspace-1" },
    ]);
    await expect(
      client.exec("update audit_events set outcome = 'completed'")
    ).rejects.toThrow("audit_events is append-only");
    await expect(client.exec("delete from audit_events")).rejects.toThrow(
      "audit_events is append-only"
    );
    await expect(client.exec("truncate audit_events")).rejects.toThrow(
      "audit_events is append-only"
    );
  });
});
