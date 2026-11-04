"use client";

import { useMutation } from "@tanstack/react-query";
import { MessageSquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";
import { authClient } from "@web/auth/client";
import { formValue, verifyPhoneNumber } from "@app/sign-in/_lib/phone-auth";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { signInRequestUri } from "@shared/identity/sign-in-link";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field";
import { Input } from "@web/components/ui/input";
import { PhoneNumberField } from "./phone-field";

export function PhoneOtpAuthForm({
  callbackUrl,
  linqPhoneNumber,
  qrCode,
}: {
  readonly callbackUrl: string;
  readonly linqPhoneNumber?: string;
  readonly qrCode?: string;
}) {
  const sendOtp = useMutation({
    mutationFn: async (phoneNumberValue: string) => {
      const phoneNumber = normalizeAuthPhoneNumber(phoneNumberValue);
      if (!phoneNumber) throw new Error("Enter a valid phone number.");

      const result = await authClient.phoneNumber
        .sendOtp({ phoneNumber })
        .catch(() => {
          throw new Error("Unable to send a code. Please try again.");
        });
      if (result.error) throw new Error(phoneOtpErrorMessage(result.error));
      return phoneNumber;
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    sendOtp.mutate(formValue(event.currentTarget, "phone-number"));
  }

  if (sendOtp.isSuccess) {
    return (
      <VerificationCodeForm
        callbackUrl={callbackUrl}
        onUseDifferentNumber={sendOtp.reset}
        phoneNumber={sendOtp.data}
      />
    );
  }

  return (
    <>
      <TextToSignIn phoneNumber={linqPhoneNumber} qrCode={qrCode} />
      <form
        className="mt-4"
        onSubmit={(event) => {
          submit(event);
        }}
      >
        <FieldGroup>
          <PhoneNumberField />
          <FieldError errors={sendOtp.error ? [sendOtp.error] : undefined} />
          <Button className="w-full" disabled={sendOtp.isPending} type="submit">
            {sendOtp.isPending ? "Sending…" : "Send code"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}

function VerificationCodeForm({
  callbackUrl,
  onUseDifferentNumber,
  phoneNumber,
}: {
  readonly callbackUrl: string;
  readonly onUseDifferentNumber: () => void;
  readonly phoneNumber: string;
}) {
  const router = useRouter();
  const verifyCode = useMutation({
    mutationFn: async (code: string) => {
      if (!/^\d{6}$/.test(code)) {
        throw new Error("Enter the six-digit code.");
      }

      await verifyPhoneNumber({
        code,
        errorMessage:
          "That code could not be verified. Request a new code and try again.",
        phoneNumber,
      });
    },
    onSuccess: () => {
      router.replace(callbackUrl);
      router.refresh();
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    verifyCode.mutate(formValue(event.currentTarget, "code").trim());
  }

  return (
    <form
      className="mt-6"
      onSubmit={(event) => {
        submit(event);
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="code">Verification Code</FieldLabel>
          <Input
            autoComplete="one-time-code"
            id="code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            pattern="[0-9]{6}"
            required
          />
        </Field>
        <FieldError
          errors={verifyCode.error ? [verifyCode.error] : undefined}
        />
        <Button
          className="w-full"
          disabled={verifyCode.isPending}
          type="submit"
        >
          {verifyCode.isPending ? "Verifying…" : "Verify code"}
        </Button>
        <Button
          className="w-full"
          disabled={verifyCode.isPending}
          onClick={onUseDifferentNumber}
          type="button"
          variant="ghost"
        >
          Use a different number
        </Button>
      </FieldGroup>
    </form>
  );
}

// Texting "Sign me in" both activates the Linq line for a new phone and
// replies with a one-tap sign-in link, so nobody types a number or a code.
function TextToSignIn({
  phoneNumber,
  qrCode,
}: {
  readonly phoneNumber?: string;
  readonly qrCode?: string;
}) {
  if (!phoneNumber) {
    return (
      <Alert className="mt-6" variant="information">
        <MessageSquareIcon />
        <AlertTitle>First time signing in?</AlertTitle>
        <AlertDescription>
          <p>
            Find the Linq number in Vercel Connect or the Linq dashboard, text
            it once from your phone, then return here.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="mt-6" variant="information">
      <MessageSquareIcon />
      <AlertTitle>Sign in by text</AlertTitle>
      <AlertDescription>
        <p>
          Text &ldquo;Sign me in&rdquo; to {phoneNumber}. You&rsquo;ll get a
          link back; tap it and you&rsquo;re in. This works the first time too.
        </p>
        {qrCode ? (
          <div className="mt-3 hidden flex-col items-center gap-1 sm:flex">
            {/* oxlint-disable-next-line nextjs/no-img-element -- a generated data URL needs no image optimization */}
            <img
              alt={`QR code that opens Messages to ${phoneNumber}`}
              className="size-40 rounded-md bg-white p-2"
              height={160}
              src={qrCode}
              width={160}
            />
            <p className="type-caption">Scan with your phone&rsquo;s camera.</p>
          </div>
        ) : null}
        <Button
          className="mt-3 w-full"
          nativeButton={false}
          render={
            <a
              aria-label="Text Sign me in in Messages"
              href={signInRequestUri(phoneNumber)}
            />
          }
          variant="outline"
        >
          Text &ldquo;Sign me in&rdquo;
        </Button>
        <p className="mt-3 type-caption">
          Or enter your number below to get a code.
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function phoneOtpErrorMessage(error: {
  readonly code?: string;
  readonly message?: string;
}) {
  return error.code?.startsWith("LINQ_") && error.message
    ? error.message
    : "Unable to send a code. Please try again.";
}
