import { LinkSignIn } from "./_components/link-sign-in";

// Opened from the one-tap link in a sign-in text. The code is in the URL
// fragment, which only the browser reads.
export default function SignInLinkPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm space-y-6">
        <LinkSignIn />
      </section>
    </main>
  );
}
