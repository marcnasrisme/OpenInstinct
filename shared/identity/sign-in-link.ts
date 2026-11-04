import { z } from "zod";
import { isE164PhoneNumber } from "@shared/identity/phone-number";

// Texting this to the assistant's number replies with a one-tap sign-in link.
const signInRequestText = "Sign me in";

export function isSignInRequest(text: string) {
  return (
    text
      .trim()
      .replace(/[.!]+$/u, "")
      .toLowerCase() === signInRequestText.toLowerCase()
  );
}

// Opens Messages to the number with the request already typed. The `?&`
// form works on both iOS and Android.
export function signInRequestUri(linePhoneNumber: string) {
  return `sms:${linePhoneNumber}?&body=${encodeURIComponent(signInRequestText)}`;
}

// The code rides in the fragment, which browsers never send to the server,
// so it stays out of request logs. It is the same one-time, five-minute
// sign-in code that is texted alongside the link.
export function signInLinkPath(phoneNumber: string, code: string) {
  return `/sign-in-link#${new URLSearchParams({ code, phone: phoneNumber }).toString()}`;
}

const signInLinkSchema = z.object({
  code: z.string().regex(/^\d{4,8}$/u),
  phone: z.string().refine(isE164PhoneNumber),
});

export function parseSignInLinkFragment(fragment: string) {
  return signInLinkSchema.safeParse(
    Object.fromEntries(new URLSearchParams(fragment.replace(/^#/u, "")))
  ).data;
}
