import { gateway } from "ai";
import { TRPCError } from "@trpc/server";
import { revokeToken, startAuthorization } from "@vercel/connect";
import { z } from "zod";
import { listBrowserTraces } from "@db/services/browser-traces";
import { listLinqPhoneNumbers } from "@db/services/auth/linq";
import { saveChat } from "@db/services/chats";
import {
  assignedInviteLines,
  createInvite,
  isOwnerUser,
  listInvites,
  revokeInvite,
} from "@db/services/invites";
import { replaceUserProfile } from "@db/services/user-profile";
import { selectModelId } from "@db/services/settings";
import { deleteVaultItem, saveVaultItem } from "@db/services/vault";
import type { AccessScope } from "@shared/identity/access-scope";
import { saveChatSchema } from "@shared/chat/schema";
import { env } from "@shared/environment";
import {
  availableModels,
  modelRoles,
  type ModelRole,
} from "@shared/models/catalog";
import {
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "@shared/google-workspace/connection";
import { userProfileSchema } from "@shared/user-profile/schema";
import {
  vaultCreateItemSchema,
  vaultImportItemsSchema,
} from "@shared/vault/schema";
import { createTRPCRouter, protectedProcedure } from "./init";

export const appRouter = createTRPCRouter({
  chats: {
    save: protectedProcedure
      .input(saveChatSchema)
      .mutation(({ ctx, input }) => saveChat(ctx.scope, input)),
  },
  googleWorkspace: {
    update: protectedProcedure
      .input(z.enum(["connect", "disconnect"]))
      .mutation(async ({ ctx, input }) => {
        if (input === "disconnect") {
          await revokeToken(env.GOOGLE_CONNECTOR_UID, {
            subject: googleWorkspaceSubject(ctx.scope.userId),
          });
          return { redirectTo: "/?google=disconnected" };
        }

        const callbackUrl = new URL("/", ctx.origin);
        callbackUrl.searchParams.set("google", "connected");
        return {
          redirectTo: await startGoogleWorkspaceAuthorization(
            ctx.scope,
            callbackUrl.toString()
          ),
        };
      }),
  },
  settings: {
    selectModel: protectedProcedure
      .input(
        z.object({
          modelId: z.string().trim().min(1).max(300),
          role: z.enum(modelRoles),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (
          !availableModels(input.role).some(({ id }) => id === input.modelId)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${input.modelId} is not an available ${input.role} model in the catalog.`,
          });
        }
        await selectModelId(ctx.scope, input.role, input.modelId);
      }),
  },
  userProfile: {
    update: protectedProcedure
      .input(userProfileSchema)
      .output(userProfileSchema)
      .mutation(({ ctx, input }) => replaceUserProfile(ctx.scope, input)),
  },
  traces: {
    list: protectedProcedure
      .input(z.object({ cursor: z.string().nullish() }))
      .query(({ ctx, input }) =>
        listBrowserTraces(ctx.scope, input.cursor ?? undefined)
      ),
  },
  vault: {
    create: protectedProcedure
      .input(vaultCreateItemSchema)
      .mutation(({ ctx, input }) => saveVaultItem(ctx.scope, input)),
    import: protectedProcedure
      .input(vaultImportItemsSchema)
      .mutation(async ({ ctx, input }) => {
        /* oxlint-disable eslint/no-await-in-loop -- Import preserves source order and avoids concurrent writes to the same vault scope. */
        for (const item of input) await saveVaultItem(ctx.scope, item);
        /* oxlint-enable eslint/no-await-in-loop */
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => deleteVaultItem(ctx.scope, input.id)),
  },
  invites: {
    create: protectedProcedure
      .input(z.object({ label: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        await requireOwner(ctx.scope);
        const linePhoneNumber = await freeInviteLine();
        const { inviteId, token } = await createInvite({
          label: input.label,
          linePhoneNumber,
          ownerUserId: ctx.scope.userId,
        });
        return {
          inviteId,
          linePhoneNumber,
          url: new URL(`/invite/${token}`, ctx.origin).toString(),
        };
      }),
    list: protectedProcedure.query(async ({ ctx }) => {
      await requireOwner(ctx.scope);
      return (await listInvites(ctx.scope.userId)).map((invite) => ({
        claimedAt: invite.claimedAt?.toISOString() ?? null,
        expiresAt: invite.expiresAt.toISOString(),
        id: invite.id,
        label: invite.label,
        linePhoneNumber: invite.linePhoneNumber,
        phoneNumber: invite.phoneNumber,
        status: invite.status,
      }));
    }),
    revoke: protectedProcedure
      .input(z.object({ inviteId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireOwner(ctx.scope);
        if (!(await revokeInvite(ctx.scope.userId, input.inviteId))) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
      }),
  },
  models: {
    list: protectedProcedure
      .input(z.object({ role: z.enum(modelRoles) }))
      .query(({ input }) => readModelCatalog(input.role)),
  },
});

export type AppRouter = typeof appRouter;

async function requireOwner(scope: AccessScope) {
  if (!(await isOwnerUser(scope.userId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the owner can manage invites.",
    });
  }
}

// One Linq number per friend. The owner keeps LINQ_PHONE_NUMBER, or the
// account's first number when it is unset.
async function freeInviteLine() {
  if (!env.LINQ_CONNECTOR) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Connect Linq before inviting friends.",
    });
  }
  const lines = await listLinqPhoneNumbers(env.LINQ_CONNECTOR);
  const ownerLine = env.LINQ_PHONE_NUMBER ?? lines[0];
  const assigned = await assignedInviteLines();
  const free = lines.find((line) => line !== ownerLine && !assigned.has(line));
  if (!free) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Every Linq number is in use. Add another number to your Linq account to invite someone else.",
    });
  }
  return free;
}

async function startGoogleWorkspaceAuthorization(
  scope: AccessScope,
  callbackUrl: string
) {
  const authorization = await startAuthorization(
    env.GOOGLE_CONNECTOR_UID,
    googleWorkspaceTokenParams(scope.userId),
    { callbackUrl, expiresInMs: 10 * 60_000 }
  );
  return authorization.url;
}

// The catalog models for a role, with gateway prices when the gateway can
// list them. Prices are optional: the catalog alone decides what is allowed.
async function readModelCatalog(role: ModelRole) {
  const prices = await gateway
    .getAvailableModels()
    .then(({ models }) => new Map(models.map((model) => [model.id, model])))
    .catch(() => new Map<string, never>());

  return availableModels(role).map((model) => {
    const listed =
      model.route.kind === "gateway"
        ? prices.get(model.route.model)
        : undefined;
    return {
      id: model.id,
      logo:
        model.route.kind === "gateway"
          ? model.route.model.split("/", 1)[0]
          : undefined,
      name: model.label,
      pricing: listed?.pricing
        ? {
            input: perMillion(listed.pricing.input),
            output: perMillion(listed.pricing.output),
          }
        : undefined,
      provider: model.provider,
      retention: model.retention.reviewed
        ? `Retention reviewed ${model.retention.checkedOn}: ${model.retention.note}`
        : `Retention not reviewed: ${model.retention.note}`,
      zeroDataRetention:
        model.route.kind === "gateway" && model.route.zeroDataRetention,
    };
  });
}

function perMillion(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}
