# Roadmap: closer to the real Instinct

- **Status:** Draft, waiting for Marc's approval
- **Date:** 2026-11-02
- **Prerequisite:** `docs/Fix plan round 1.md` (PRs 0–6) is merged first. Each
  feature below adds a new way for untrusted text to reach the agent (texts,
  calls, group members, inbound mail). Approvals, the owner allowlist and the
  audit log must exist before any of them ships.

## Where the fork stands on Instinct's ten reach items

Instinct's list comes from `docs/Best Instinct alternative agents.md`. The
fork's status comes from reading the code at `d78cb0a` and the
`eve@1.0.0-rc.1` docs.

| #   | Instinct capability         | Fork today                    | Evidence                                                                                                   |
| --- | --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | iMessage                    | **Yes**, direct messages only | `agent/channels/linq.ts`                                                                                   |
| 2   | SMS / WhatsApp              | **No**                        | No channel. eve ships a Twilio SMS channel (`docs/channels/twilio`)                                        |
| 3   | You call it                 | **No**                        | eve's Twilio channel transcribes calls but replies by SMS, not by voice                                    |
| 4   | Calls businesses for you    | **No**                        | Nothing in the code or in eve                                                                              |
| 5   | Group chats                 | **No**                        | `linq.ts:76` turns non-DM threads away                                                                     |
| 6   | Gmail / Calendar            | **Yes** (plus Contacts)       | `agent/tools/gmail.ts`, `calendar.ts`, `contacts.ts`                                                       |
| 7   | Cloud computer + logins     | **Yes**                       | Kernel browsers with saved profiles, vault autofill                                                        |
| 8   | Its own email address       | **No**                        | Sends only as the user, through Gmail                                                                      |
| 9   | Proactive (texts you first) | **Partly**                    | Runs only schedules you create (`agent/tools/schedules.ts`, cron every minute); nothing watches on its own |
| 10  | Purchases                   | **Partly**                    | Saved-card autofill works (ungated until fix PR 1). Link wallet is disabled (`patches/README.md`)          |

So today the fork has 3 of 10 fully and 2 partly. Instinct has 9 fully and 1
partly.

## Round 2: features, in order

Order rule: cheapest and safest first, building on what eve already provides.
Every action that reaches someone else goes through an ADR-002 approval gate
and an audit row.

| #   | Feature                       | Closes item         | Approach                                                                                                                                                                                                                              | Size        | New cost                                                                       |
| --- | ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| R1  | **Proactive brief and watch** | 9                   | A built-in daily schedule that runs the existing **read-only** scheduled worker over calendar and inbox. It texts only when something needs you (a conflict, a deadline, a reply you're waiting on). A "quiet hours" setting applies. | S           | Model calls only                                                               |
| R2  | **SMS + inbound calls**       | 2 (SMS), 3 (partly) | Add eve's `twilioChannel` with `allowFrom` set to the owner allowlist from fix PR 3. Approvals arrive as numbered SMS options. Needs the fix PR 5 delivery module.                                                                    | S–M         | Twilio number about $1–2/month, plus per-message and per-minute fees           |
| R3  | **Group chats**               | 5                   | Allow Linq group threads. Only the owner can trigger gated tools or approve them: an ADR-002 `response` policy plus `samePrincipal`. Other members' messages count as untrusted input.                                                | M           | None                                                                           |
| R4  | **Agent's own email address** | 8                   | Use a separate mailbox for the agent (e.g. a new Google account, or an inbound-mail service), never Marc's. Inbound mail counts as untrusted input. Every outbound send is gated.                                                     | M           | $0 with a free Gmail account; a paid Workspace seat or mail service costs more |
| R5  | **Voice conversation**        | 3                   | Replace "transcribe, then reply by SMS" with a real-time voice provider (e.g. Vapi or Twilio's voice AI) that calls the same agent session. Approvals still go by text, never by voice.                                               | L           | About $0.05/min plus telephony                                                 |
| R6  | **Calls to businesses**       | 4                   | An outbound-call tool gated with `always()`. The prompt shows the number, who it belongs to, and the script. A recording disclosure is played. Calls only numbers you approve.                                                        | L           | As R5. Consent and recording laws apply (see the eve Twilio docs)              |
| R7  | **WhatsApp**                  | 2                   | Check first whether eve or a Chat SDK adapter supports WhatsApp; Meta Business verification is required.                                                                                                                              | M           | Per-conversation fees                                                          |
| R8  | **Wallet purchases**          | 10                  | Turn Link back on once `@stripe/link-integrations-eve` supports eve 1.0. Until then, gated saved-card fills (fix PR 1) are the purchase path.                                                                                         | S (blocked) | None                                                                           |

After R1–R4 the fork has about 7 of 10, at low cost and with no new legal
exposure. R5–R6 are the expensive, legally sensitive part (calling). R7–R8
depend on outside vendors.

## Where this beats Instinct (keep these as differences)

- Approvals are enforced in code, and the approval prompt shows the real
  recipients and content (ADR-002).
- You can read the append-only audit log.
- You choose the model, and its provider and retention terms are recorded
  (fix PR 6).
- Disconnecting Google deletes the data that came from Google. This is backlog
  in the fix plan; plan it into round 2, right after R1, since R1 reads the
  inbox on a schedule.
- No training on your data, because you run it yourself and pick providers
  with no-training terms.

## How each feature is tested

The pattern comes from `docs/Fix plan round 1.md`:

- **Unit:** channel auth (allowlist, group-member roles), approval policies,
  and quiet hours.
- **Evals (with stubs, `requireInteraction`):** for each new input surface
  (SMS, group message, inbound email, call transcript), run one injection case.
  The injected text tries to make the agent send email or make a call, and the
  case passes only if no gated tool runs without approval.
- **Manual:** one real run per feature, with an audit-log check.

## Decisions for Marc

1. Approve this order, or pick which features matter most to you.
2. R4: a new Google account for the agent, or an inbound-mail service?
3. R5/R6: is voice worth about $0.05/min plus legal homework for v1, or should
   it wait?
