import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "@db/schema";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("owner allowlist", () => {
  it("signs in an owner and refuses codes and accounts for anyone else", async () => {
    // Local development verifies any code without sending one, so the
    // allowlist itself is the only thing keeping other numbers out here.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("OWNER_PHONE_NUMBERS", "+12025550123");
    const client = new PGlite();
    try {
      await client.exec(
        await readFile(
          new URL("../../db/migrations/0001_better-auth.sql", import.meta.url),
          "utf8"
        )
      );
      await client.exec(
        await readFile(
          new URL("../../db/migrations/0014_chief_tigra.sql", import.meta.url),
          "utf8"
        )
      );
      const database = drizzle(client, { schema });
      const Database = await import("@db");
      // SAFETY: PGlite implements the shared Drizzle query-builder and transaction API used by these services.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only the database driver changes in this integration test.
      vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
      const { getAuth } = await import("@db/services/auth");
      const auth = await getAuth();

      await expect(
        auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+12025550199" } })
      ).rejects.toMatchObject({ body: { code: "PHONE_NOT_ALLOWED" } });
      await expect(
        auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+12025550123" } })
      ).resolves.toBeDefined();

      await expect(
        auth.api.verifyPhoneNumber({
          body: { code: "123456", phoneNumber: "+12025550199" },
        })
      ).rejects.toBeDefined();
      const owner = await auth.api.verifyPhoneNumber({
        body: { code: "123456", phoneNumber: "+12025550123" },
      });

      expect(owner.user.phoneNumber).toBe("+12025550123");
      const users = await database
        .select({ phoneNumber: schema.user.phoneNumber })
        .from(schema.user);
      expect(users).toEqual([{ phoneNumber: "+12025550123" }]);
    } finally {
      await client.close();
    }
  });
});
