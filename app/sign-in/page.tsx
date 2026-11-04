import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { LocalPhoneAuthForm } from "@app/sign-in/_components/local-form";
import { PhoneOtpAuthForm } from "@app/sign-in/_components/otp-form";
import { env, localPhoneAuthBypassEnabled } from "@shared/environment";
import { getAuthSession } from "@db/services/auth/session";
import { readLinqOnboardingPhoneNumber } from "@db/services/auth/linq";
import { assignedInviteLines } from "@db/services/invites";
import { signInRequestUri } from "@shared/identity/sign-in-link";
import QRCode from "qrcode";

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const reauthenticate = params.reauthenticate === "true";
  if (!reauthenticate && (await getAuthSession(await headers()))) redirect("/");

  const callbackValue = params.callbackUrl;
  const requestedCallback = Array.isArray(callbackValue)
    ? callbackValue[0]
    : callbackValue;
  const callbackUrl =
    requestedCallback?.startsWith("/") && !requestedCallback.startsWith("//")
      ? requestedCallback
      : "/";
  const linqConfigured = env.LINQ_CONNECTOR !== undefined;
  const ownerLine =
    localPhoneAuthBypassEnabled || !env.LINQ_CONNECTOR
      ? undefined
      : (env.LINQ_PHONE_NUMBER ??
        (await readLinqOnboardingPhoneNumber(env.LINQ_CONNECTOR)));
  // An invited friend arrives with their own number; accept it only if an
  // invite holds it, so a crafted link cannot point the QR code elsewhere.
  const requestedLine = Array.isArray(params.line)
    ? params.line[0]
    : params.line;
  const linqPhoneNumber =
    ownerLine &&
    requestedLine &&
    (await assignedInviteLines()).has(requestedLine)
      ? requestedLine
      : ownerLine;
  const qrCode = linqPhoneNumber
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        await QRCode.toString(signInRequestUri(linqPhoneNumber), {
          margin: 1,
          type: "svg",
        })
      )}`
    : undefined;

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="type-page-title">
            {reauthenticate ? "Sign in again" : "Sign In"}
          </h1>
          <p className="type-supporting-body text-muted-foreground">
            Enter your phone number to sign in.
          </p>
        </div>
        {!localPhoneAuthBypassEnabled && !linqConfigured ? (
          <p className="type-supporting-body text-muted-foreground">
            iMessage sign-in is not configured for this deployment. Attach a
            Linq connector through Vercel Connect.
          </p>
        ) : localPhoneAuthBypassEnabled ? (
          <LocalPhoneAuthForm callbackUrl={callbackUrl} />
        ) : (
          <PhoneOtpAuthForm
            callbackUrl={callbackUrl}
            linqPhoneNumber={linqPhoneNumber}
            qrCode={qrCode}
          />
        )}
      </section>
    </main>
  );
}
