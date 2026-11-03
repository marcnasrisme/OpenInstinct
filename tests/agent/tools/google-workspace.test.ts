import { describe, expect, it, vi } from "vitest";
import type * as GmailModule from "@agent/lib/google-workspace/gmail";
import type { sendGmail, updateGmail } from "@agent/lib/google-workspace/gmail";
import * as Audit from "@db/services/audit";
import { toolContextFor } from "@tests/helpers/tool-context";

const gmail = vi.hoisted(() => ({
  send: vi.fn<typeof sendGmail>(),
  update: vi
    .fn<typeof updateGmail>()
    .mockResolvedValue({ action: "archive", updatedCount: 2 }),
}));

vi.mock("@agent/lib/google-workspace/gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof GmailModule>()),
  sendGmail: gmail.send,
  updateGmail: gmail.update,
}));

const recordAuditEvent = vi.spyOn(Audit, "recordAuditEvent");

import { gmailSend, gmailUpdate } from "@agent/tools/gmail";

describe("Google Workspace tools", () => {
  it("reports the selected Gmail update without an action discriminator", async () => {
    const context = toolContext();
    const result = await gmailUpdate.execute(
      { messageIds: ["message-1", "message-2"], update: "archive" },
      context
    );

    expect(gmail.update).toHaveBeenCalledExactlyOnceWith(
      context,
      ["message-1", "message-2"],
      "archive"
    );
    expect(result).toEqual({ update: "archive", updatedCount: 2 });
  });

  it("records the send intent before sending, and sends nothing if that fails", async () => {
    const email = {
      bcc: [],
      body: "Running late.",
      cc: [],
      subject: "Late",
      to: ["bob@example.com"],
    };
    const context = signedInContext();
    recordAuditEvent.mockResolvedValueOnce();
    gmail.send.mockResolvedValueOnce({ id: "message-1", threadId: "thread-1" });

    await gmailSend.execute(email, context);

    expect(recordAuditEvent).toHaveBeenCalledOnce();
    expect(recordAuditEvent.mock.calls[0]?.[0]).toEqual({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    expect(recordAuditEvent.mock.calls[0]?.[1]).toMatchObject({
      callId: "call-1",
      phase: "intent",
      summary: { to: ["bob@example.com"] },
      toolName: "gmail-send",
    });
    expect(recordAuditEvent.mock.invocationCallOrder[0]).toBeLessThan(
      gmail.send.mock.invocationCallOrder[0] ?? 0
    );

    vi.clearAllMocks();
    recordAuditEvent.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(gmailSend.execute(email, context)).rejects.toThrow(
      "database unavailable"
    );
    expect(gmail.send).not.toHaveBeenCalled();
  });
});

function signedInContext() {
  return toolContextFor({
    auth: {
      current: null,
      initiator: {
        attributes: { workspaceId: "workspace-1" },
        authenticator: "test",
        principalId: "user-1",
        principalType: "user",
      },
    },
    callId: "call-1",
    sessionId: "session-1",
    toolName: "gmail-send",
  });
}

function toolContext() {
  return toolContextFor({
    callId: "call-1",
    sessionId: "session-1",
    toolName: "gmail-update",
  });
}
