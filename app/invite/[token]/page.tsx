import { Button } from "@web/components/ui/button";
import { Field, FieldError, FieldLabel } from "@web/components/ui/field";
import { Input } from "@web/components/ui/input";
import { readOpenInvite } from "@db/services/invites";
import { claimInviteAction } from "./_lib/claim";

export default async function InvitePage({
  params,
  searchParams,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const phoneError = (await searchParams).error === "phone";
  const invite = await readOpenInvite(token);

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm space-y-6">
        {invite ? (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="type-page-title">
                Hi {invite.label}, you&rsquo;re invited
              </h1>
              <p className="type-supporting-body text-muted-foreground">
                Try a personal assistant you text. It can read and draft email,
                check your calendar, and use a web browser for you. It asks you
                first before it sends an email, invites anyone, or uses a saved
                card.
              </p>
            </div>
            <ul className="type-supporting-body space-y-1 text-muted-foreground">
              <li>Your assistant&rsquo;s number: {invite.linePhoneNumber}</li>
              <li>
                Your chats, memory, and saved logins stay in your own private
                workspace.
              </li>
              <li>
                The person who invited you runs this server and can technically
                access its data. Every action is recorded in an audit log.
              </li>
            </ul>
            <form
              action={claimInviteAction.bind(null, token)}
              className="space-y-4"
            >
              <Field>
                <FieldLabel htmlFor="phone-number">
                  Your phone number
                </FieldLabel>
                <Input
                  aria-invalid={phoneError}
                  autoComplete="tel"
                  id="phone-number"
                  name="phone-number"
                  placeholder="(202) 555-0123"
                  required
                  size="xl"
                  type="tel"
                />
                <FieldError
                  errors={
                    phoneError
                      ? [{ message: "Enter a valid phone number." }]
                      : undefined
                  }
                />
              </Field>
              <Button className="w-full" type="submit">
                Accept invite
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <h1 className="type-page-title">
              This invite link isn&rsquo;t valid
            </h1>
            <p className="type-supporting-body text-muted-foreground">
              It may have expired or already been used. Ask the person who sent
              it for a new link.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
