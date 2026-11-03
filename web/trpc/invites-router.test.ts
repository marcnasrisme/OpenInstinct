import type * as EnvModule from "@shared/environment";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Linq from "@db/services/auth/linq";
import * as Invites from "@db/services/invites";
import type { AccessScope } from "@shared/identity/access-scope";

vi.mock("@shared/environment", async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>();
  return {
    ...original,
    env: {
      ...original.env,
      LINQ_CONNECTOR: "linq/test",
      LINQ_PHONE_NUMBER: "+12025550100",
    },
  };
});

import { appRouter } from "./router";

const scope = {
  userId: "better-auth:owner",
  workspaceId: "workspace-1",
} satisfies AccessScope;
const isOwnerUser = vi.spyOn(Invites, "isOwnerUser");
const assignedInviteLines = vi.spyOn(Invites, "assignedInviteLines");
const createInvite = vi.spyOn(Invites, "createInvite");
const listLinqPhoneNumbers = vi.spyOn(Linq, "listLinqPhoneNumbers");

function caller() {
  return appRouter.createCaller({ origin: "https://assistant.example", scope });
}

beforeEach(() => {
  vi.clearAllMocks();
  isOwnerUser.mockResolvedValue(true);
  listLinqPhoneNumbers.mockResolvedValue([
    "+12025550100",
    "+12025550101",
    "+12025550102",
  ]);
  assignedInviteLines.mockResolvedValue(new Set(["+12025550101"]));
  createInvite.mockResolvedValue({ inviteId: "invite-1", token: "token-1" });
});

describe("invites router", () => {
  it("gives a new friend the first number nobody else holds", async () => {
    await expect(caller().invites.create({ label: "Sam" })).resolves.toEqual({
      inviteId: "invite-1",
      linePhoneNumber: "+12025550102",
      url: "https://assistant.example/invite/token-1",
    });
    expect(createInvite).toHaveBeenCalledWith({
      label: "Sam",
      linePhoneNumber: "+12025550102",
      ownerUserId: "better-auth:owner",
    });
  });

  it("keeps the owner's number and explains when every number is taken", async () => {
    assignedInviteLines.mockResolvedValue(
      new Set(["+12025550101", "+12025550102"])
    );

    await expect(caller().invites.create({ label: "Sam" })).rejects.toThrow(
      "Every Linq number is in use. Add another number to your Linq account to invite someone else."
    );
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("lets only the owner create, list, or revoke invites", async () => {
    isOwnerUser.mockResolvedValue(false);

    await expect(caller().invites.create({ label: "Sam" })).rejects.toThrow(
      "Only the owner can manage invites."
    );
    await expect(caller().invites.list()).rejects.toThrow(
      "Only the owner can manage invites."
    );
    await expect(
      caller().invites.revoke({
        inviteId: "00000000-0000-4000-8000-000000000001",
      })
    ).rejects.toThrow("Only the owner can manage invites.");
    expect(listLinqPhoneNumbers).not.toHaveBeenCalled();
  });
});
