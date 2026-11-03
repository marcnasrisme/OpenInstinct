# ADR-001: Choose the open-source base to fork for an Instinct-style agent

- **Status:** Proposed (awaiting Marc's decision)
- **Date:** 2026-11-02

## Context

We want to recreate Instinct: an assistant you text or call. It works in your email, calendar and a logged-in browser, books things, buys things and messages you first. It also has to fix the places where Instinct failed: approval before irreversible actions, an audit log, and a model provider you know and choose.

**Hard requirement:** the codebase must be clean and well-structured.

We shallow-cloned eight candidates. First we measured them (size, file sizes, tests, CI, open issues). Then the five that remained each got an in-depth, read-only code review against the same checklist. Nothing from these repos was run.

## Options considered

### First cut, on measurements

| Repo            | Why it was cut                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| OpenClaw        | 5.9M lines, 7.7k open issues and PRs, and you already rejected it in Feb 2026 |
| ZeroClaw (Rust) | Single files of up to 55k lines; 4% as much test code as source               |
| Vellum          | 1.4M lines; no lint config; 67 files over 1,500 lines                         |

### In-depth reviews

Scores are out of 10.

| Repo                             | Lang   | Structure | Extend to Instinct | Security | Instinct features present                                                                                                       |
| -------------------------------- | ------ | --------- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **OpenInstinct** (Merit Systems) | TS     | **8**     | 5                  | 5        | iMessage (Linq), Gmail/Cal/Contacts, Kernel browser with saved logins, encrypted vault and autofill, scheduled messages, memory |
| nanobot (HKUDS)                  | Python | 6         | 7                  | 4        | WhatsApp, email, scheduled messages, memory, MCP, 47 model providers                                                            |
| NanoClaw                         | TS     | 6         | 6                  | **7**    | iMessage, WhatsApp, calls, email (all as code-copying "skills")                                                                 |
| Hermes Agent                     | Python | 4         | 7                  | 5        | ~75–80%: iMessage, WhatsApp, SMS, vault, logged-in browser, outbound calls                                                      |
| PicoClaw (Go)                    | Go     | 5         | 6                  | 3        | WhatsApp, scheduler                                                                                                             |

### Key findings per option

- **OpenInstinct**
  - Structure:
    - Layer boundaries are enforced by a custom lint rule.
    - 0 uses of `any`, and every type assertion needs a justifying comment.
    - A dead-code checker, a median file of 59 lines, and safety and prompt-injection evals.
  - Problems:
    - The agent runtime is an external framework, `eve`, pinned to a release candidate and patched.
    - Deeply tied to Vercel (Connect, OIDC, Blob, Workflow).
    - Approvals were deliberately removed: Gmail send and saved-card fills run without asking.
    - The `playwright_execute` tool lets the model read autofilled secrets.
    - No audit log, voice, MCP or agent-owned email address.
- **nanobot**
  - Structure: core vs. channel boundaries are enforced in CI, and you can delete channels cleanly.
  - Problems:
    - The core is a god-object: a 35-parameter constructor and a 350-line loop.
    - Typing escapes: 1.3k `cast` and ~4k `Any`.
    - Hooks can't veto tool calls, and there's no audit log.
    - Permissive shell defaults.
- **NanoClaw**
  - Security: the best container isolation and credential gateway of any candidate.
  - Problems: channels live on a separate branch and are copied in by skills. That model is hostile to a long-lived fork, and the project has 36 BREAKING releases.
- **Hermes**
  - Features: the most of any candidate.
  - Problems:
    - Its core packages all import each other in cycles.
    - `hermes_cli` is load-bearing for everything.
    - God objects were split into 14–19 mixins rather than redesigned.
    - It cannot be pruned or kept in sync. It fails the hard requirement.
- **PicoClaw**
  - Problems:
    - 700-line functions.
    - Linters disabled "because they are failing".
    - Insecure defaults.
    - It is self-described as "self-bootstrapped" by an AI agent.

## Decision (recommended)

**Fork OpenInstinct.** It is the only candidate that clearly meets the clean-codebase requirement. It is also already shaped like Instinct (iMessage, browser with logins, vault, Gmail).

Its biggest gaps (approvals, the secret leak, the audit log) are exactly where Instinct failed. They are also small, well-located fixes:

1. Re-enable eve approvals on `gmail-send`, calendar create and payment `fill_from_vault`. Delete the "no approval step" instruction and its test.
2. Remove `playwright_execute`, or redact vault fields from browser tool output.
3. Add an owner allowlist to signup.
4. Add an append-only `audit_events` table written from a tool-call hook.
5. Pull Linq delivery out into a channel-neutral module, which prepares the code for adding WhatsApp/SMS.
6. Stay on Vercel for v1. Put Blob, Connect and OIDC behind adapters only if leaving Vercel becomes a goal.

**Fallback: nanobot**, if staying in Python matters more or Vercel lock-in is unacceptable. The cost is building iMessage, SMS, a browser vault, approvals and an audit log yourself, plus refactoring `AgentLoop`.

## Consequences

**Positive**

- You start from the cleanest code reviewed.
- About half of Instinct is already working.
- The approval and audit fixes are a few files each.

**Negative and risks**

- **TypeScript, not Python.** You're learning Python. Strict TS is a good teacher, but it's a second language.
- **eve rc dependency.** The agent loop isn't in the repo. eve 1.0 already broke Link purchases. You'll need to pin it and read its changelog on every upgrade.
- **Running cost.** Vercel Pro (~$20/mo) is required, plus Linq, Kernel, Neon and model usage.
- **Transparency.** Models go through Vercel AI Gateway, so check its retention and training terms. You still choose and can name the model. The default root model is `openai/gpt-6.1-sol-fast`, and the browser worker is hard-coded to `meta/muse-spark-1.3`. Change both to models whose terms you have read.
- **Young project.** It is about 2 months old with 6 contributors and fast churn. Merit Systems also runs Assistant Benchmark, a possible conflict of interest in how its scores are presented.
- **Still missing vs. Instinct:** voice calls (hard), an agent-owned email address, WhatsApp/SMS, and MCP.
