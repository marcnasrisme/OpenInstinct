import type { Fact, SessionView } from "eve/events";
import type { HookContext } from "eve/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Audit from "@db/services/audit";
import {
  auditApprovalAnswered,
  auditApprovalOpened,
  auditCallSettled,
  auditCallStarted,
} from "@agent/lib/audit/events";
import { auditSummary } from "@agent/lib/audit/summary";
import { hookContextFor } from "@tests/helpers/hook-context";
import { viewOf } from "@tests/helpers/session-view";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const auth: HookContext["session"]["auth"] = {
  current: null,
  initiator: {
    attributes: { workspaceId: scope.workspaceId },
    authenticator: "test",
    principalId: scope.userId,
    principalType: "user",
  },
};
const email = {
  bcc: [],
  body: "Card 4242424242424242, see you at 7.",
  cc: [],
  subject: "Dinner",
  to: ["bob@example.com"],
};
const recordAuditEvent = vi.spyOn(Audit, "recordAuditEvent");

beforeEach(() => {
  vi.clearAllMocks();
  recordAuditEvent.mockResolvedValue();
});

describe("audit summaries", () => {
  it("keeps email recipients and a body hash, never the body", () => {
    const summary = auditSummary("gmail-send", email);

    expect(summary).toMatchObject({
      bodyLength: email.body.length,
      subject: "Dinner",
      to: ["bob@example.com"],
    });
    expect(summary.bodySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(summary)).not.toContain("4242424242424242");
  });

  it("records only the name of a tool that is not on the allowlist", () => {
    expect(
      auditSummary("web_fetch", { url: "https://secret.example" })
    ).toEqual({});
    expect(auditSummary("gmail-send", { to: "not an email list" })).toEqual({});
  });
});

describe("audit hooks", () => {
  it("records an approved send from request to completion", async () => {
    const view = viewOf([
      requestedSend(),
      [approvalOpened()],
      [
        {
          data: {
            deliveryId: "delivery-2",
            interactionId: "interaction-1",
            responseId: "response-1",
            value: { optionId: "approve" },
          },
          type: "response.submitted",
        },
        {
          data: { outcome: "applied", responseId: "response-1" },
          type: "response.settled",
        },
        {
          data: { interactionId: "interaction-1", outcome: "accepted" },
          type: "interaction.settled",
        },
      ],
    ]);
    const ctx = contextFor(view);

    await auditApprovalOpened(approvalOpened(), ctx);
    await auditApprovalAnswered(
      {
        data: {
          interactionId: "interaction-1",
          outcome: "accepted",
          response: { optionId: "approve", text: "typed note" },
        },
        type: "interaction.settled",
      },
      ctx
    );
    await auditCallStarted(
      {
        data: {
          callId: "call-1",
          clearedBy: { interactionId: "interaction-1" },
        },
        type: "call.started",
      },
      ctx
    );
    await auditCallSettled(
      {
        data: { callId: "call-1", outcome: "completed" },
        type: "call.settled",
      },
      ctx
    );

    const phases = recordAuditEvent.mock.calls.map(([, event]) => event);
    expect(phases.map(({ phase }) => phase)).toEqual([
      "approval_opened",
      "approval_answered",
      "started",
      "settled",
    ]);
    expect(phases[0]).toMatchObject({
      actor: "user-1",
      callId: "call-1",
      interactionId: "interaction-1",
      sessionId: "session-1",
      summary: { subject: "Dinner", to: ["bob@example.com"] },
      toolName: "gmail-send",
    });
    expect(phases[1]).toMatchObject({ outcome: "approve" });
    expect(phases[2]).toMatchObject({
      clearedBy: { interactionId: "interaction-1" },
      interactionId: "interaction-1",
    });
    expect(phases[3]).toMatchObject({ outcome: "completed" });
    expect(JSON.stringify(phases)).not.toContain("4242424242424242");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ phase: "started" })
    );
  });

  it("leaves approvals relayed from a subagent to the subagent's own hook", async () => {
    const view = viewOf([requestedSend()]);
    const relayed = approvalOpened();

    await auditApprovalOpened(
      {
        ...relayed,
        data: {
          ...relayed.data,
          origin: { interactionId: "child-interaction", sessionId: "child" },
        },
      },
      contextFor(view)
    );

    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a failed write so the turn stops", async () => {
    recordAuditEvent.mockRejectedValue(new Error("database unavailable"));

    await expect(
      auditCallStarted(
        { data: { callId: "call-1" }, type: "call.started" },
        contextFor(viewOf([requestedSend()]))
      )
    ).rejects.toThrow("database unavailable");
  });
});

function requestedSend(): Fact[] {
  return [
    {
      data: { owner: { turnId: "turn-1" }, runId: "run-1" },
      scope: { runId: "run-1", turnId: "turn-1" },
      type: "model.requested",
    },
    {
      data: {
        callId: "call-1",
        capability: { kind: "tool", name: "gmail-send" },
        input: email,
        owner: { runId: "run-1" },
      },
      scope: { runId: "run-1", turnId: "turn-1" },
      type: "call.requested",
    },
  ];
}

function approvalOpened() {
  return {
    data: {
      interactionId: "interaction-1",
      request: {
        kind: "approval" as const,
        options: [
          { id: "approve", label: "Approve" },
          { id: "deny", label: "Deny" },
        ],
        prompt: "Send this email?",
      },
      subject: { callId: "call-1" },
    },
    type: "interaction.opened" as const,
  };
}

function contextFor(view: SessionView) {
  return hookContextFor({ auth, sessionId: "session-1", view });
}
