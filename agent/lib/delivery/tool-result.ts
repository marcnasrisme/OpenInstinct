import type { AdapterPostableMessage } from "chat";
import type { SessionContext } from "eve/context";
import type { CallSettled, SessionView } from "eve/events";
import type { z } from "zod";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { settledToolResult } from "@agent/lib/settled-tool-result";
import { prepareLinqImageArtifactDelivery } from "@agent/lib/linq-image-artifact/delivery";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "@agent/lib/linq-image-artifact/markdown";
import {
  finalizeScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";
import {
  sendMessageToolResultSchema,
  type ReplyReference,
} from "@shared/chat/message-delivery";
import {
  reactToMessageToolResultSchema,
  type reactToMessageOutputSchema,
} from "@shared/chat/reaction";

export type OutgoingMessage = Extract<AdapterPostableMessage, { raw: string }>;

interface DeliveryOptions {
  readonly idempotencyKey?: string;
  readonly replyToMessageId?: string;
}

// How one messaging channel posts what send_message and react_to_message
// decided. The channel owns its wire format, including falling back to a
// plain message when a reply target is gone.
export interface MessageTransport {
  /** The channel's name in error messages, such as "Linq". */
  readonly label: string;
  /** The message in this conversation that a reply reference points to. */
  replyMessageId(reference: ReplyReference | undefined): string | undefined;
  react(
    messageId: string,
    reaction: z.output<typeof reactToMessageOutputSchema>
  ): Promise<void>;
  sendLink(url: string, options: DeliveryOptions): Promise<void>;
  sendMessage(
    outgoing: OutgoingMessage,
    options: DeliveryOptions
  ): Promise<void>;
}

type DeliveryContext = SessionContext & { readonly view: SessionView };

// Delivers a settled send_message or react_to_message call through the
// conversation's transport; `transport` is undefined without an active
// conversation thread.
export async function deliverToolResult(
  event: CallSettled,
  ctx: DeliveryContext,
  transport: MessageTransport | undefined
) {
  const result = settledToolResult(event, ctx.view);

  const reaction = reactToMessageToolResultSchema.safeParse(result);
  if (reaction.success) {
    const channel = requireTransport(transport, "react_to_message");
    const messageId = channel.replyMessageId({ kind: "current" });
    if (!messageId) {
      throw new Error(
        `react_to_message requires a current ${channel.label} message.`
      );
    }
    await channel.react(messageId, reaction.data.output);
    await finalizeScheduledReportDelivery(ctx);
    return;
  }

  const message = sendMessageToolResultSchema.safeParse(result);
  if (!message.success || message.data.toolName !== "send_message") return;
  const channel = requireTransport(transport, "send_message");
  const report = scheduledReportFromSession(ctx);
  const options = {
    idempotencyKey: report
      ? `scheduled-report:${report.runId}:${String(report.sequence)}`
      : undefined,
    replyToMessageId: channel.replyMessageId(message.data.output.replyTo),
  };

  const { output } = message.data;
  if (output.kind === "link") {
    await channel.sendLink(output.url, options);
  } else {
    const outgoing = await composeOutgoingMessage(output, ctx);
    if (outgoing) await channel.sendMessage(outgoing, options);
  }
  await finalizeScheduledReportDelivery(ctx);
}

function requireTransport(
  transport: MessageTransport | undefined,
  toolName: string
) {
  if (!transport) {
    throw new Error(`${toolName} requires an active conversation thread.`);
  }
  return transport;
}

type MessageOutput = Exclude<
  z.output<typeof sendMessageToolResultSchema>["output"],
  { readonly kind: "link" }
>;

// Turns send_message text and attachments into one outgoing message,
// attaching browser images the text references. Returns undefined when
// there is nothing to send.
async function composeOutgoingMessage(
  output: MessageOutput,
  ctx: DeliveryContext
): Promise<OutgoingMessage | undefined> {
  const attachments = output.attachments?.map(({ kind, ...attachment }) => ({
    ...attachment,
    type: kind,
  }));
  const requestedText = output.text;
  if (!requestedText) {
    return attachments?.length ? { attachments, raw: "" } : undefined;
  }

  const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
  if (!caller) {
    const references = extractImageArtifactMarkdownReferences(requestedText);
    const text =
      references.length === 0
        ? requestedText
        : [
            stripImageArtifactMarkdownReferences(requestedText),
            "I couldn't attach the image.",
          ]
            .filter(Boolean)
            .join("\n\n");
    return withAttachments({ raw: text }, attachments);
  }

  const report = scheduledReportFromSession(ctx);
  const delivery = await prepareLinqImageArtifactDelivery(requestedText, {
    rootSessionId: report?.workerSessionId ?? ctx.session.id,
    scope: scopeFromPrincipal(caller),
  });
  if (delivery.failedArtifactIds.length > 0) {
    console.warn("[delivery] browser image delivery failed", {
      artifactIds: delivery.failedArtifactIds,
      sessionId: ctx.session.id,
    });
  }
  const failureMessage =
    delivery.failedArtifactIds.length === 0
      ? ""
      : delivery.failedArtifactIds.length === 1
        ? "I couldn't attach one image."
        : `I couldn't attach ${String(delivery.failedArtifactIds.length)} images.`;
  const outgoing = withAttachments(
    { raw: [delivery.text, failureMessage].filter(Boolean).join("\n\n") },
    attachments
  );
  if (delivery.files.length > 0) outgoing.files = delivery.files;
  return outgoing;
}

function withAttachments(
  outgoing: OutgoingMessage,
  attachments: OutgoingMessage["attachments"]
) {
  if (attachments?.length) outgoing.attachments = attachments;
  return outgoing;
}
