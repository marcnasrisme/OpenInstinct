import { sql } from "drizzle-orm";
import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const inviteStatuses = ["open", "claimed", "revoked"] as const;

// An owner's invitation for one friend: a link that lets one phone number
// sign in, and the Linq number that friend texts. Only a SHA-256 of the
// link's token is stored, so the table never holds a usable link.
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenSha256: text("token_sha256").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    label: text("label").notNull(),
    linePhoneNumber: text("line_phone_number").notNull(),
    phoneNumber: text("phone_number"),
    status: text("status", { enum: inviteStatuses }).notNull().default("open"),
    createdAt: timestamp("created_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull(),
    claimedAt: timestamp("claimed_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      name: "invites_created_by_fkey",
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
    uniqueIndex("invites_token_idx").on(table.tokenSha256),
    // A number serves one friend at a time, and a phone holds one invite.
    uniqueIndex("invites_line_active_idx")
      .on(table.linePhoneNumber)
      .where(sql`${table.status} <> 'revoked'`),
    uniqueIndex("invites_phone_active_idx")
      .on(table.phoneNumber)
      .where(sql`${table.status} <> 'revoked'`),
  ]
);
