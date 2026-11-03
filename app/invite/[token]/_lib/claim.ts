"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { claimInvite } from "@db/services/invites";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";

// Binds the invite to the visitor's phone number, then sends them to sign in
// with that number. The invite link itself never signs anyone in.
export async function claimInviteAction(token: string, formData: FormData) {
  const entered = z.string().safeParse(formData.get("phone-number"));
  const phoneNumber = entered.success
    ? normalizeAuthPhoneNumber(entered.data)
    : undefined;
  if (!phoneNumber) redirect(`/invite/${token}?error=phone`);

  const claimed = await claimInvite(token, phoneNumber);
  if (claimed === "unavailable") redirect(`/invite/${token}`);
  redirect("/sign-in?callbackUrl=/");
}
