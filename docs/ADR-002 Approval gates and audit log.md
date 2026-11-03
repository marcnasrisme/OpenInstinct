# ADR-002: Approval gates and audit log

- **Status:** Proposed (awaiting Marc's decision)
- **Date:** 2026-11-02
- **Deciders:** Marc
- **Builds on:** ADR-001 (fork OpenInstinct). Evidence: `docs/Review 2026-11-02 security and tech debt.md`

## Context

Instinct failed in three ways: it sent an email without approval, it kept
inbox data after Google was disconnected, and it obeyed a prompt injection.
OpenInstinct has the same exposure today:

- `gmail-send`, `calendar-create-event` and `fill_from_vault` (saved cards)
  run with no approval. Upstream removed `approval: always()` in commit
  `4cf6404` to avoid "approval loops": the model asked "Send it?" in text, then
  eve showed a second, bare "Approve gmail-send?" prompt.
- The only safety rule is a prompt (`execution-safety.md:3`). A prompt cannot
  protect against prompt injection, because the injected text is in the same
  context as the rule.
- No record exists of what the agent did, who approved it, or why. Browser
  traces are browser-only, best-effort, and cascade-delete.

What eve `1.0.0-rc.1` provides (checked in the published docs,
`tools/human-in-the-loop.md` and `guides/hooks.md`):

- `approval` on any `defineTool`: `never()`, `once()`, `always()`, `auto()`,
  or a policy function that receives `{ session, toolInput, toolName, callId }`
  and returns `"user-approval"`, `"not-applicable"`, `"approved"`, `"denied"`
  or `{ type: "denied", reason }`. The object form
  `{ request, prompt, response }` replaces the default prompt text.
- A call waiting for approval has not started, and a denied call never runs.
  The pause survives restarts.
- Approvals from the browser subagent are relayed to the parent session. A
  message from the parent agent cannot answer them; only a person's answer can.
- By default, only the person whose turn asked for the call can approve it.
- Linq is a text-only Chat SDK channel. It shows **one request at a time**, and
  the user answers with "approve", "yes", "deny", "no" or the option number.
  `agent/channels/linq.ts:66` already leaves approvals to the default handler.
- Hooks receive `call.started` (with `clearedBy`: a policy or an
  `interactionId`), `call.settled` (with `outcome` and `cause`),
  `interaction.opened` and `interaction.settled`. Hooks are **not
  exactly-once**: after an interruption some handlers may not run. Parent hooks
  do **not** run for subagent turns.

Constraints: one owner (Marc), iMessage through Linq as the main surface, and
Vercel + Neon Postgres for v1. The codebase must stay clean: no generic
`utils`, one owner per concept (`AGENTS.md`).

## Decision

### 1. Code-level approval gates on every consequential tool

| Tool                    | Policy                                                                                | Prompt shows (built from validated input by code, not written by the model)          |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `gmail-send`            | `always()`                                                                            | To, Cc, Bcc, Subject, and the first 600 characters of the body plus its total length |
| `calendar-create-event` | `user-approval` if `attendees.length > 0`, otherwise `not-applicable`                 | Title, start–end with time zone, attendees ("Google will email these people")        |
| `fill_from_vault`       | `user-approval` if the item is `payment`; `login` and `address` stay `not-applicable` | Merchant origin, card label (e.g. "Visa ··4242"), and the total the worker declares  |

- `fill_from_vault` gets two new required inputs, `expectedOrigin` and
  `declaredTotal` (amount in minor units plus currency). They appear in the
  prompt, and `execute` refuses to fill when the current page origin differs
  from `expectedOrigin`. What Marc approves is then what the code enforces.
- The policy (which can be async) reads the vault item's kind through the
  existing `readVaultItem` scope check, without touching secret values. The
  `prompt` callback only gets `{ input, toolName, callId }`, so PR 1 must check
  whether it can be async and look up the card label. If it cannot, the prompt
  says "a saved card" and never uses a label written by the model.
- **Never use `auto()`.** It sends tool input to TypeSafe AI's `jev` model,
  an extra data processor Marc has not chosen.
- No `once()` for these tools. Each send or fill gets its own approval.
- Scheduled runs keep their read-only tool sets (`gmail.ts:74`,
  `calendar.ts:58`). Gated tools are never added to `scheduled-worker`.

### 2. Prompts change to stop the approval loop

- Delete "Tools run without a separate Eve approval step" (`execution-safety.md:4`).
- Restore the pre-`4cf6404` rule: "Call the gated tool directly with the
  exact fields. Do not ask for approval in prose first. The approval prompt is
  the confirmation."
- The prompt rule on line 3 stays, as a second layer behind the code gate.

### 3. Append-only `audit_events` table, written from hooks and fail-closed for gated tools

```text
audit_events
  id               uuid pk
  workspace_id     text not null           -- no FK, so it never cascades
  session_id       text not null
  root_session_id  text                    -- parent session for browser-agent calls
  call_id          text not null
  tool_name        text not null
  phase            text not null           -- intent | approval_opened | approved | denied | started | settled
  outcome          text                    -- succeeded | failed | rejected | interrupted
  cleared_by       jsonb                   -- {interactionId} or {policy:"approval"} from call.started
  actor            text                    -- principalId of the requester or approver
  summary          jsonb not null          -- redacted, per-tool allowlist (below)
  created_at       timestamptz not null default now()
  unique (call_id, phase)
```

- **Append-only in the database:** a trigger raises on `UPDATE` and
  `DELETE`. Deleting rows needs a deliberate migration or admin script, never
  application code.
- **Two writers, one service** (`db/services/audit.ts`):
  1. **Hooks** (`agent/hooks/audit.ts` and
     `agent/subagents/browser-agent/hooks/audit.ts`; both are needed because
     parent hooks skip subagent turns) record `approval_opened`,
     `approved`/`denied`, `started` and `settled` for **every** tool call.
     Writes use `on conflict (call_id, phase) do nothing`, since hooks can
     replay.
  2. **Gated tools** write an `intent` row inside `execute`, **before** the
     side effect. If that write fails, the email is not sent and the card is
     not filled. This covers the case where a hook is skipped.
- **The summary is an allowlist per tool, never a raw input dump.** For
  `gmail-send`: recipients, subject, a SHA-256 of the body, and the body
  length. For `fill_from_vault`: kind, item label, origin and declared total.
  Unknown tools record only the tool name. A vault value can never reach the
  audit table, even from a tool added later.
- Shared code lives in `agent/lib/audit/` (summarizers and event mapping), as
  the "concrete owner" rule in `AGENTS.md` requires.
- **Retention:** kept until Marc deletes his account. That rule is written in
  the README's data section.

## Options considered

### Option A: Prompt-only safety (status quo)

| Dimension            | Assessment                                          |
| -------------------- | --------------------------------------------------- |
| Complexity           | Low                                                 |
| Cost                 | None                                                |
| Injection resistance | **None**: the rule and the attack share one context |
| Familiarity          | Already in place                                    |

**Pros:** No friction.
**Cons:** It is exactly how Instinct failed, and there is nothing to audit.

### Option B: eve `approval` on specific tools + hook-based audit (chosen)

| Dimension            | Assessment                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- |
| Complexity           | Medium: three tools, two hooks, one table, one service                             |
| Cost                 | One extra iMessage round trip per send or card fill                                |
| Injection resistance | High for gated tools: the prompt is rendered by code from the real input           |
| Familiarity          | Uses eve's documented API; the gate is the same one upstream used before `4cf6404` |

**Pros:** Small, uses the framework's own durable pause, works on Linq today,
and the subagent relay is built in.
**Cons:** Browser clicks (e.g. "Place order") are not gated directly; the card
fill is the choke point. A logged-in site action without a card (posting,
cancelling a booking) is still ungated. See Consequences.

### Option C: Gate everything with `auto()` or a central policy layer

| Dimension            | Assessment                                                           |
| -------------------- | -------------------------------------------------------------------- |
| Complexity           | High                                                                 |
| Cost                 | A model call per tool call, plus an extra third-party data processor |
| Injection resistance | Medium: a classifier can be fooled too                               |
| Familiarity          | Low                                                                  |

**Pros:** Broad coverage, including browser actions.
**Cons:** Sends data to a provider Marc has not chosen, makes things slower,
and makes the behavior harder to predict. Rejected for v1.

### Option D: Audit in Vercel logs or OpenTelemetry only

**Cons:** Retention is set by Vercel, logs are not append-only from Marc's
point of view, and eve records approver IDs in spans only for public or
development conversations. Rejected as the system of record; it can stay as
debugging telemetry.

## Trade-off analysis

- **Safety vs. friction:** each email and card fill costs one reply such as
  "yes". The "approval loop" upstream disliked came from asking twice (in
  prose, then in a bare prompt). One code-rendered prompt fixes that.
- **Fail-closed vs. availability:** if Postgres is down, gated actions stop.
  That is acceptable for a personal agent; reads keep working.
- **Hook coverage vs. exactly-once:** hooks can miss or replay events, so the
  gated tools write their own `intent` row, and the unique key absorbs replays.

## Consequences

- **Easier:** answering "what did it send, and who said yes?" from one table;
  turning on real Gmail and cards safely; showing an activity view in the web
  app later.
- **Harder:** every new side-effecting tool needs an approval decision and an
  audit summarizer. A test in PR 1 enforces this (see the fix plan).
- **Revisit:**
  - Gating high-risk browser actions (submit, cancel, post) once the worker's
    actions can be classified, probably at `browser_act` or `playwright_execute`.
  - Deleting session data when Google is disconnected (review finding 9).
  - Whether Linq's "one request at a time" causes confusion when the agent
    asks a question and needs an approval in the same turn.

## Action items

1. [ ] PR 1: approval gates and prompt changes (fix plan item 1).
2. [ ] PR 2: vault-value redaction and `playwright_execute` restriction (item 2).
3. [ ] PR 4: `audit_events` migration, service, hooks and `intent` writes (item 4).
4. [ ] Document data retention for the audit table and logs in the README.
