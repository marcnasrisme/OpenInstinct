"use client";

import { useState } from "react";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import { Field, FieldError, FieldLabel } from "@web/components/ui/field";
import { Input } from "@web/components/ui/input";
import { api } from "@web/trpc/client";

// Owner-only: one invite link per friend, each with its own Linq number.
export function FriendInvites() {
  const utils = api.useUtils();
  const invites = api.invites.list.useQuery();
  const [label, setLabel] = useState("");
  const [link, setLink] = useState<string>();
  const create = api.invites.create.useMutation({
    onSuccess: async ({ url }) => {
      setLink(url);
      setLabel("");
      await utils.invites.list.invalidate();
    },
  });
  const revoke = api.invites.revoke.useMutation({
    onSuccess: () => utils.invites.list.invalidate(),
  });

  return (
    <div className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ label });
        }}
      >
        <Field className="flex-1">
          <FieldLabel htmlFor="invite-label">Friend&rsquo;s name</FieldLabel>
          <Input
            id="invite-label"
            maxLength={80}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
            placeholder="Sam"
            required
            value={label}
          />
        </Field>
        <Button disabled={create.isPending} type="submit">
          Create invite link
        </Button>
      </form>
      <FieldError errors={create.error ? [create.error] : undefined} />

      {link ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="type-label">Send this link to your friend</p>
          <p className="type-caption break-all text-muted-foreground">{link}</p>
          <p className="type-caption text-muted-foreground">
            It works once, for one phone number, and expires in 7 days. It is
            shown only now.
          </p>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(link);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Copy link
          </Button>
        </div>
      ) : null}

      <ul className="divide-y divide-border">
        {(invites.data ?? []).map((invite) => (
          <li className="flex items-center gap-3 py-3" key={invite.id}>
            <div className="min-w-0 flex-1">
              <p className="type-label">{invite.label}</p>
              <p className="truncate type-caption text-muted-foreground">
                Texts {invite.linePhoneNumber}
                {invite.phoneNumber ? ` from ${invite.phoneNumber}` : ""}
              </p>
            </div>
            <Badge variant="secondary">
              {invite.status === "claimed" ? "Joined" : "Link not used yet"}
            </Badge>
            <Button
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate({ inviteId: invite.id });
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
