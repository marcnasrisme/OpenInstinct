"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@web/auth/client";
import { parseSignInLinkFragment } from "@shared/identity/sign-in-link";
import { Button } from "@web/components/ui/button";

export function LinkSignIn() {
  const router = useRouter();
  const signIn = useMutation({
    mutationFn: async () => {
      const link = parseSignInLinkFragment(window.location.hash);
      // Drop the code from the address bar and history either way.
      window.history.replaceState(null, "", window.location.pathname);
      if (!link) throw new Error("This sign-in link is incomplete.");
      const verified = await authClient.phoneNumber
        .verify({
          code: link.code,
          disableSession: false,
          phoneNumber: link.phone,
          updatePhoneNumber: false,
        })
        .catch(() => ({ error: true }));
      if (verified.error) {
        throw new Error(
          "This sign-in link has expired or was already used. Text “Sign me in” again for a new one."
        );
      }
    },
    onSuccess: () => {
      router.replace("/");
      router.refresh();
    },
  });
  const { mutate } = signIn;

  useEffect(() => {
    mutate();
  }, [mutate]);

  if (signIn.isError) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="type-page-title">Couldn&rsquo;t sign you in</h1>
        <p className="type-supporting-body text-muted-foreground">
          {signIn.error.message}
        </p>
        <Button nativeButton={false} render={<Link href="/sign-in" />}>
          Back to sign in
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <h1 className="type-page-title">Signing you in…</h1>
      <p className="type-supporting-body text-muted-foreground">One moment.</p>
    </div>
  );
}
