import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function invitesService() {
  vi.stubEnv("OWNER_PHONE_NUMBERS", "+12025550100");
  const client = new PGlite();
  databases.push(client);
  /* oxlint-disable eslint/no-await-in-loop -- SQL migration statements must execute in file order. */
  for (const file of [
    "0001_better-auth.sql",
    "0014_chief_tigra.sql",
    "0018_slippery_lester.sql",
  ]) {
    const migration = await readFile(
      new URL(`../migrations/${file}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  await client.exec(`
    insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "phoneNumber", "phoneNumberVerified")
    values ('owner', 'Owner', 'owner@example.invalid', false, now(), now(), '+12025550100', true),
           ('friend', 'Friend', 'friend@example.invalid', false, now(), now(), '+12025550111', true)
  `);
  vi.resetModules();
  const Db = await import("@db");
  // SAFETY: PGlite implements the query-builder surface exercised by this service despite using a different Drizzle driver.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test swaps only the driver while retaining the shared Drizzle schema and query-builder contract.
  const database = drizzle(client, { schema }) as never;
  vi.spyOn(Db, "db", "get").mockReturnValue(database);
  return import("@db/services/invites");
}

describe("friend invites", () => {
  it("lets one phone claim a link once and gives it the invite's number", async () => {
    const invites = await invitesService();
    const { token } = await invites.createInvite({
      label: "Sam",
      linePhoneNumber: "+12025550199",
      ownerUserId: "better-auth:owner",
    });

    expect(await invites.readOpenInvite(token)).toEqual({
      label: "Sam",
      linePhoneNumber: "+12025550199",
    });
    expect(await invites.isAllowedPhoneNumber("+12025550111")).toBe(false);

    expect(await invites.claimInvite(token, "+12025550111")).toBe("claimed");
    expect(await invites.claimInvite(token, "+12025550122")).toBe(
      "unavailable"
    );
    expect(await invites.readOpenInvite(token)).toBeUndefined();
    expect(await invites.isAllowedPhoneNumber("+12025550111")).toBe(true);
    expect(await invites.isAllowedPhoneNumber("+12025550122")).toBe(false);
    expect(await invites.claimedInviteLine("+12025550111")).toBe(
      "+12025550199"
    );
    expect(await invites.assignedInviteLines()).toEqual(
      new Set(["+12025550199"])
    );
  });

  it("rejects unknown and expired links and stores only a hash", async () => {
    const invites = await invitesService();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { token } = await invites.createInvite({
      label: "Sam",
      linePhoneNumber: "+12025550199",
      ownerUserId: "better-auth:owner",
    });
    const rows = await invites.listInvites("better-auth:owner");
    expect(JSON.stringify(rows)).not.toContain(token);

    expect(await invites.claimInvite("not-a-token", "+12025550111")).toBe(
      "unavailable"
    );
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await invites.readOpenInvite(token)).toBeUndefined();
    expect(await invites.claimInvite(token, "+12025550111")).toBe(
      "unavailable"
    );
  });

  it("frees the number and ends access when the owner revokes", async () => {
    const invites = await invitesService();
    const { inviteId, token } = await invites.createInvite({
      label: "Sam",
      linePhoneNumber: "+12025550199",
      ownerUserId: "better-auth:owner",
    });
    await invites.claimInvite(token, "+12025550111");

    expect(await invites.revokeInvite("better-auth:friend", inviteId)).toBe(
      false
    );
    expect(await invites.revokeInvite("better-auth:owner", inviteId)).toBe(
      true
    );
    expect(await invites.isAllowedPhoneNumber("+12025550111")).toBe(false);
    expect(await invites.assignedInviteLines()).toEqual(new Set());
    expect(await invites.listInvites("better-auth:owner")).toEqual([]);
  });

  it("knows the owner from OWNER_PHONE_NUMBERS and never invites an owner", async () => {
    const invites = await invitesService();
    expect(await invites.isOwnerUser("better-auth:owner")).toBe(true);
    expect(await invites.isOwnerUser("better-auth:friend")).toBe(false);
    expect(await invites.isOwnerUser("owner")).toBe(false);

    const { token } = await invites.createInvite({
      label: "Me",
      linePhoneNumber: "+12025550199",
      ownerUserId: "better-auth:owner",
    });
    expect(await invites.claimInvite(token, "+12025550100")).toBe(
      "already-allowed"
    );
    expect(await invites.readOpenInvite(token)).toBeDefined();
  });
});
