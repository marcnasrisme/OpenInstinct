import type { LinqAPIV3 } from "@linqapp/sdk";
import type { AdapterPostableMessage } from "chat";
import {
  defaultLinqAuth,
  linqChannel,
  type LinqChannelCredentials,
} from "eve/channels/linq";
import { vercelOidc } from "eve/channels/auth";
import { z } from "zod";
import {
  deliverToolResult,
  type MessageTransport,
} from "@agent/lib/delivery/tool-result";
import { resolveLinqReplyTarget } from "@agent/lib/reply-targets";
import { getAuth, requestSignInLink } from "@db/services/auth";
import { isSignInRequest } from "@shared/identity/sign-in-link";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { env } from "@shared/environment";
import { isAllowedPhoneNumber } from "@db/services/invites";
import {
  linqCredentials,
  sendNativeLinqMessage,
} from "@agent/lib/linq/transport";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});
const unavailableReplyTargetSchema = z.object({
  status: z.union([z.literal(400), z.literal(404)]),
});

type LinqMessageContent = Parameters<
  LinqAPIV3["chats"]["messages"]["send"]
>[1]["message"];

const trustedForwarder = vercelOidc();

// The Linq adapter only rejects a webhook when the verifier returns `false`,
// while eve's OIDC verifier reports failure as `null`. Translate explicitly so
// an unverified forwarder can never reach message dispatch.
export const linqWebhookVerifier: NonNullable<
  LinqChannelCredentials["webhookVerifier"]
> = async (request) => (await trustedForwarder(request)) ?? false;

const credentials = {
  ...linqCredentials,
  webhookVerifier: env.LINQ_CONNECTOR ? linqWebhookVerifier : () => false,
} satisfies LinqChannelCredentials;

export default linqChannel({
  credentials,
  events: {
    async "interaction.opened"(event, ctx) {
      const { origin, request } = event.data;
      const { thread } = ctx.channel;
      // Approvals and questions render through the default committed handler;
      // delegated sign-ins stay out of the root conversation.
      if (
        request.kind !== "sign-in" ||
        !thread ||
        (origin !== undefined && origin.sessionId !== ctx.session.id)
      )
        return;
      const signIn = request.signIn;
      const displayName = signIn?.displayName ?? signIn?.name ?? "this account";
      if (!thread.isDM) {
        await thread.post({
          raw: `Connect ${displayName} in a direct message with this agent.`,
        });
        return;
      }
      const adapter = ctx.channel.bot.getAdapter("linq");
      const { chatId, pendingHandle } = adapter.decodeThreadId(thread.id);
      if (!chatId || pendingHandle)
        throw new Error(
          "Authorization delivery requires an existing Linq conversation."
        );
      const parts: NonNullable<LinqMessageContent["parts"]> = [
        {
          type: "text",
          value: [
            signIn?.instructions ?? `Connect ${displayName} to continue.`,
            signIn?.userCode ? `Code: ${signIn.userCode}` : undefined,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ];
      const idempotencyKey = `authorization:${ctx.session.id}:${event.data.interactionId}`;
      await sendNativeLinqMessage(chatId, {
        parts,
        idempotency_key: `${idempotencyKey}:prompt`,
      });
      // Linq requires a native link to be the message's only part.
      if (signIn?.url)
        await sendNativeLinqMessage(chatId, {
          parts: [{ type: "link", value: signIn.url }],
          idempotency_key: `${idempotencyKey}:link`,
        });
    },
    async "call.settled"(event, ctx) {
      const { bot, thread } = ctx.channel;
      if (!thread) {
        await deliverToolResult(event, ctx, undefined);
        return;
      }
      const adapter = bot.getAdapter("linq");
      const transport: MessageTransport = {
        label: "Linq",
        replyMessageId(reference) {
          // The thread is a persisted snapshot; auth identifies this incoming message.
          const target = resolveLinqReplyTarget(reference, ctx.session.auth);
          return target?.conversationId === thread.id
            ? target.messageId
            : undefined;
        },
        async react(messageId, { operation, type }) {
          if (operation === "remove") {
            await adapter.removeReaction(thread.id, messageId, type);
          } else {
            await adapter.addReaction(thread.id, messageId, type);
          }
        },
        async sendLink(url, { idempotencyKey, replyToMessageId }) {
          const { chatId, pendingHandle } = adapter.decodeThreadId(thread.id);
          if (pendingHandle || !chatId) {
            throw new Error("A Linq reply requires an existing conversation.");
          }
          const sendLink = (replyTo?: string) => {
            const nativeMessage: LinqMessageContent = {
              parts: [{ type: "link", value: url }],
            };
            if (idempotencyKey) nativeMessage.idempotency_key = idempotencyKey;
            if (replyTo) nativeMessage.reply_to = { message_id: replyTo };
            return sendNativeLinqMessage(chatId, nativeMessage);
          };
          try {
            await sendLink(replyToMessageId);
          } catch (error) {
            if (
              !replyToMessageId ||
              !unavailableReplyTargetSchema.safeParse(error).success
            ) {
              throw error;
            }
            console.warn("[linq] reply target is unavailable", {
              sessionId: ctx.session.id,
            });
            await sendLink();
          }
        },
        async sendMessage(outgoing, { idempotencyKey, replyToMessageId }) {
          await sendLinqMessage({
            outgoing,
            post: idempotencyKey
              ? (content) =>
                  adapter.postMessage(thread.id, content, { idempotencyKey })
              : (content) => thread.post(content),
            postReply: (content, replyTo) =>
              adapter.postMessage(
                thread.id,
                content,
                idempotencyKey
                  ? { idempotencyKey, replyToMessageId: replyTo }
                  : { replyToMessageId: replyTo }
              ),
            replyToMessageId,
          });
        },
      };
      await deliverToolResult(event, ctx, transport);
    },
    // Linq output is delivered only through send_message, so the default
    // reply posting is replaced with a no-op.
    // oxlint-disable-next-line eslint/no-empty-function -- Overriding the built-in handler suppresses automatic reply posting.
    async "content.completed"() {},
    async "session.ended"(_event, ctx) {
      if (scheduledReportFromSession(ctx)) {
        await finalizeScheduledReportDelivery(ctx, "suppressed");
      }
    },
    async "turn.settled"(event, ctx) {
      if (event.data.outcome === "completed") {
        if (scheduledReportFromSession(ctx)) {
          await finalizeScheduledReportDelivery(ctx, "suppressed");
        }
      } else if (event.data.outcome === "cancelled") {
        await releaseScheduledReportDelivery(
          ctx,
          "Scheduled result reporting was cancelled."
        );
      } else {
        await releaseScheduledReportDelivery(
          ctx,
          event.data.error?.message ?? "The scheduled report turn failed."
        );
      }
    },
  },
  async onMessage(context, message) {
    if (message.author.isBot) return null;

    const auth = defaultLinqAuth(message);
    const authorUserName = z.string().safeParse(message.author.userName);
    const phoneNumber = authorUserName.success
      ? normalizeAuthPhoneNumber(authorUserName.data)
      : undefined;
    const allowed =
      phoneNumber !== undefined && (await isAllowedPhoneNumber(phoneNumber));
    // "Sign me in" asks for a one-tap web sign-in link; it is not a request
    // for the agent, and it also works before the account exists.
    if (phoneNumber && allowed && isSignInRequest(message.text)) {
      await requestSignInLink(phoneNumber);
      return null;
    }
    const verifiedUserId =
      phoneNumber && allowed
        ? await findVerifiedAuthUserIdByPhoneNumber(phoneNumber)
        : undefined;
    if (!verifiedUserId || !phoneNumber) {
      // Phone possession is the only sign-in factor, so a handle that is not
      // an owner or invited friend linked to a verified user is
      // unauthenticated: never mint a principal or a workspace for it.
      console.warn("[linq] ignoring message from a non-owner handle", {
        threadId: context.thread.id,
      });
      return null;
    }
    const principalId = `better-auth:${verifiedUserId}`;
    const scope = accessScopeForUser(principalId);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          conversationChannel: "linq",
          conversationId: context.thread.id,
          linqThreadId: context.thread.id,
          linqMessageId: message.id,
          phoneNumber,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
    };
  },
});

async function sendLinqMessage({
  outgoing,
  post,
  postReply,
  replyToMessageId,
}: {
  readonly outgoing: Extract<AdapterPostableMessage, { raw: string }>;
  readonly post: (
    content: AdapterPostableMessage
  ) => Promise<{ readonly id: string }>;
  readonly postReply: (
    content: AdapterPostableMessage,
    replyToMessageId: string
  ) => Promise<{ readonly id: string }>;
  readonly replyToMessageId?: string;
}) {
  if (!replyToMessageId) {
    await post(outgoing);
    return;
  }
  try {
    await postReply(outgoing, replyToMessageId);
    return;
  } catch (error) {
    if (!unavailableReplyTargetSchema.safeParse(error).success) throw error;
    console.warn("[linq] reply target is unavailable", {
      replyToMessageId,
    });
    await post(outgoing);
  }
}

async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const auth = await getAuth();
  const context = await auth.$context;
  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  const parsed = verifiedPhoneUserSchema.safeParse(user);
  return parsed.success ? parsed.data.id : undefined;
}
