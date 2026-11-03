import type { CallSettled, Fact, JsonValue } from "eve/events";
import { describe, expect, it, vi } from "vitest";
import {
  deliverToolResult,
  type MessageTransport,
} from "@agent/lib/delivery/tool-result";
import { hookContextFor } from "@tests/helpers/hook-context";
import { viewOf } from "@tests/helpers/session-view";

// A second channel with its own wire format, to show the delivery module
// decides what to send without knowing anything about Linq.
function fakeTransport() {
  return {
    label: "Fake",
    react: vi.fn<MessageTransport["react"]>(async () => undefined),
    replyMessageId: vi.fn<MessageTransport["replyMessageId"]>((reference) =>
      reference?.kind === "current" ? "inbound-1" : undefined
    ),
    sendLink: vi.fn<MessageTransport["sendLink"]>(async () => undefined),
    sendMessage: vi.fn<MessageTransport["sendMessage"]>(async () => undefined),
  } satisfies MessageTransport;
}

describe("channel-neutral delivery", () => {
  it("sends send_message text as one message, replying when asked", async () => {
    const transport = fakeTransport();

    await deliverToolResult(
      settled({
        kind: "message",
        replyTo: { kind: "current" },
        text: "Booked for 7:15.",
      }),
      contextFor("send_message"),
      transport
    );

    expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
      { raw: "Booked for 7:15." },
      { idempotencyKey: undefined, replyToMessageId: "inbound-1" }
    );
    expect(transport.sendLink).not.toHaveBeenCalled();
  });

  it("sends a native link through the link path", async () => {
    const transport = fakeTransport();

    await deliverToolResult(
      settled({ kind: "link", url: "https://example.com/booking" }),
      contextFor("send_message"),
      transport
    );

    expect(transport.sendLink).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/booking",
      { idempotencyKey: undefined, replyToMessageId: undefined }
    );
  });

  it("reacts to the current message and names the channel when there is none", async () => {
    const transport = fakeTransport();
    const ctx = contextFor("react_to_message");
    const reaction = settled({ operation: "add", type: "heart" });

    await deliverToolResult(reaction, ctx, transport);
    expect(transport.react).toHaveBeenCalledExactlyOnceWith("inbound-1", {
      operation: "add",
      type: "heart",
    });

    transport.replyMessageId.mockReturnValue(undefined);
    await expect(deliverToolResult(reaction, ctx, transport)).rejects.toThrow(
      "react_to_message requires a current Fake message."
    );
  });

  it("requires a conversation for send_message and ignores other tools", async () => {
    await expect(
      deliverToolResult(
        settled({ kind: "message", text: "hi" }),
        contextFor("send_message"),
        undefined
      )
    ).rejects.toThrow("send_message requires an active conversation thread.");

    const transport = fakeTransport();
    await deliverToolResult(
      settled({ results: [] }),
      contextFor("web_search"),
      transport
    );
    expect(transport.sendMessage).not.toHaveBeenCalled();
  });
});

function settled(output: JsonValue): CallSettled {
  return {
    data: { callId: "call-1", outcome: "completed", output },
    type: "call.settled",
  };
}

function contextFor(toolName: string) {
  const facts: Fact[] = [
    {
      data: { owner: { turnId: "turn-1" }, runId: "run-1" },
      scope: { runId: "run-1", turnId: "turn-1" },
      type: "model.requested",
    },
    {
      data: {
        callId: "call-1",
        capability: { kind: "tool", name: toolName },
        input: {},
        owner: { runId: "run-1" },
      },
      scope: { runId: "run-1", turnId: "turn-1" },
      type: "call.requested",
    },
  ];
  return hookContextFor({ view: viewOf([facts]) });
}
