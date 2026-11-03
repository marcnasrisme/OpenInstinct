import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { db, invites, user } from "@db";
import { isOwnerPhoneNumber } from "@shared/environment";

const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const betterAuthPrefix = "better-auth:";

function tokenSha256(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Owners are listed in OWNER_PHONE_NUMBERS; friends hold a claimed invite.
export async function isAllowedPhoneNumber(phoneNumber: string) {
  return (
    isOwnerPhoneNumber(phoneNumber) ||
    (await claimedInviteLine(phoneNumber)) !== undefined
  );
}

// The Linq number a friend was given, so codes and replies come from it.
export async function claimedInviteLine(phoneNumber: string) {
  const rows = await db
    .select({ linePhoneNumber: invites.linePhoneNumber })
    .from(invites)
    .where(
      and(eq(invites.phoneNumber, phoneNumber), eq(invites.status, "claimed"))
    )
    .limit(1);
  return rows[0]?.linePhoneNumber;
}

// Only owners may invite. `userId` is the access-scope user ID.
export async function isOwnerUser(userId: string) {
  if (!userId.startsWith(betterAuthPrefix)) return false;
  const rows = await db
    .select({ phoneNumber: user.phoneNumber })
    .from(user)
    .where(eq(user.id, userId.slice(betterAuthPrefix.length)))
    .limit(1);
  const phoneNumber = rows[0]?.phoneNumber;
  return phoneNumber ? isOwnerPhoneNumber(phoneNumber) : false;
}

// Lines held by open or claimed invites; a revoked invite frees its line.
export async function assignedInviteLines() {
  const rows = await db
    .select({ linePhoneNumber: invites.linePhoneNumber })
    .from(invites)
    .where(ne(invites.status, "revoked"));
  return new Set(rows.map(({ linePhoneNumber }) => linePhoneNumber));
}

// Returns the only copy of the link token; the table keeps its hash.
export async function createInvite({
  label,
  linePhoneNumber,
  ownerUserId,
}: {
  readonly label: string;
  readonly linePhoneNumber: string;
  readonly ownerUserId: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const [invite] = await db
    .insert(invites)
    .values({
      createdByUserId: ownerUserId.slice(betterAuthPrefix.length),
      expiresAt: new Date(Date.now() + inviteLifetimeMs),
      label,
      linePhoneNumber,
      tokenSha256: tokenSha256(token),
    })
    .returning({ id: invites.id });
  if (!invite) throw new Error("The invite was not created.");
  return { inviteId: invite.id, token };
}

export async function listInvites(ownerUserId: string) {
  return db
    .select({
      claimedAt: invites.claimedAt,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      id: invites.id,
      label: invites.label,
      linePhoneNumber: invites.linePhoneNumber,
      phoneNumber: invites.phoneNumber,
      status: invites.status,
    })
    .from(invites)
    .where(
      and(
        eq(invites.createdByUserId, ownerUserId.slice(betterAuthPrefix.length)),
        ne(invites.status, "revoked")
      )
    )
    .orderBy(desc(invites.createdAt));
}

// Revoking ends the friend's access at their next sign-in or text.
export async function revokeInvite(ownerUserId: string, inviteId: string) {
  const rows = await db
    .update(invites)
    .set({ status: "revoked" })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.createdByUserId, ownerUserId.slice(betterAuthPrefix.length))
      )
    )
    .returning({ id: invites.id });
  return rows.length > 0;
}

export async function readOpenInvite(token: string) {
  const rows = await db
    .select({ label: invites.label, linePhoneNumber: invites.linePhoneNumber })
    .from(invites)
    .where(
      and(
        eq(invites.tokenSha256, tokenSha256(token)),
        eq(invites.status, "open"),
        gt(invites.expiresAt, new Date())
      )
    )
    .limit(1);
  return rows[0];
}

// Binds an open invite to the friend's phone number, once.
export async function claimInvite(token: string, phoneNumber: string) {
  if (isOwnerPhoneNumber(phoneNumber)) return "already-allowed" as const;
  if ((await claimedInviteLine(phoneNumber)) !== undefined) {
    return "already-allowed" as const;
  }
  const rows = await db
    .update(invites)
    .set({ claimedAt: new Date(), phoneNumber, status: "claimed" })
    .where(
      and(
        eq(invites.tokenSha256, tokenSha256(token)),
        eq(invites.status, "open"),
        gt(invites.expiresAt, new Date())
      )
    )
    .returning({ id: invites.id });
  return rows.length > 0 ? ("claimed" as const) : ("unavailable" as const);
}
