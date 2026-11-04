import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rootAgent from "@agent/agent";
import fillFromVault from "@agent/subagents/browser-agent/tools/fill_from_vault";
import { calendarCreateEvent } from "@agent/tools/calendar";
import { gmailSend } from "@agent/tools/gmail";

const rootTools = "agent/tools";
const rootMemory = "agent/memory/profile.ts";
const workerRoot = "agent/subagents/browser-agent";
const workerTools = `${workerRoot}/tools`;

function toolFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return toolFiles(path, root);
      return entry.name.endsWith(".ts") ? path.slice(root.length + 1) : [];
    })
    .toSorted();
}

describe("root and worker capability boundaries", () => {
  it("keeps root coordination separate from browser execution", () => {
    expect(rootAgent.defaultTools).toBe(false);
    expect(toolFiles(rootTools)).toEqual([
      "ask_question.ts",
      "calendar.ts",
      "contacts.ts",
      "gmail.ts",
      "messaging.ts",
      "run_browser.ts",
      "schedules.ts",
      "vault.ts",
      "visuals.ts",
      "web_fetch.ts",
      "web_search.ts",
    ]);
    expect(existsSync(`${rootTools}/sendMessage.ts`)).toBe(false);
    // Eve's built-in `eve__task_cancel` replaces the authored cancel tool.
    expect(existsSync(`${rootTools}/task_cancel.ts`)).toBe(false);
    expect(existsSync("agent/extensions/kernel/extension.ts")).toBe(false);
    expect(existsSync("agent/extensions/kernel/connections/browser.ts")).toBe(
      false
    );
    expect(existsSync("agent/skills/browser-execution/SKILL.md")).toBe(false);
    const rootInstructions = readFileSync(
      "agent/instructions/content/role/interactive.md",
      "utf8"
    );
    expect(rootInstructions).toContain(
      "Perform public research, source discovery, comparisons, and current-information lookups directly with `web_search`"
    );
    expect(rootInstructions).toContain(
      "try `web_fetch` before browser automation"
    );
  });

  it("keeps durable memory scoped to the authenticated root user", () => {
    const memory = readFileSync(rootMemory, "utf8");

    expect(memory).toContain("defineMemory(");
    expect(memory).toContain("scope: resolveProfileMemoryScope");
  });

  it("gives worker the browser and opaque-vault tools without messaging", () => {
    expect(toolFiles(workerTools)).toEqual([
      "bash.ts",
      "capture_browser_image.ts",
      "computer_action.ts",
      "fill_from_link.ts",
      "fill_from_vault.ts",
      "list_vault.ts",
      "manage_browsers.ts",
      "personal_info.ts",
      "read_file.ts",
      "semantic_browser.ts",
      "web_fetch.ts",
      "web_search.ts",
      "write_file.ts",
    ]);
    expect(existsSync(`${workerRoot}/tools/sendMessage.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/tools/request_vault_setup.ts`)).toBe(
      false
    );
    expect(existsSync(`${workerTools}/ask_question.ts`)).toBe(false);
    expect(readFileSync(`${workerTools}/personal_info.ts`, "utf8")).toContain(
      "disableTool()"
    );
    // Skills load through Eve's built-in `eve__skill`, not an authored tool.
    expect(existsSync(`${workerTools}/load_skill.ts`)).toBe(false);
    for (const tool of [
      "bash",
      "read_file",
      "web_fetch",
      "web_search",
      "write_file",
    ]) {
      expect(readFileSync(`${workerTools}/${tool}.ts`, "utf8")).toContain(
        "disableTool()"
      );
    }
    expect(existsSync(`${workerRoot}/extensions/kernel/extension.ts`)).toBe(
      false
    );
    expect(readFileSync("package.json", "utf8")).not.toContain(
      "@onkernel/eve-extension"
    );
    for (const tool of [
      "capture_browser_image",
      "computer_action",
      "manage_browsers",
    ]) {
      const source = readFileSync(`${workerTools}/${tool}.ts`, "utf8");
      expect(source).toContain("defineTool(");
      expect(source).not.toContain("defineDynamic(");
      expect(source).toContain("requireWorkerScope(context)");
    }
    expect(existsSync(`${workerRoot}/hooks/session-owner.ts`)).toBe(true);
    expect(existsSync(`${workerRoot}/skills/browser-execution/SKILL.md`)).toBe(
      false
    );
    const semanticBrowser = readFileSync(
      `${workerTools}/semantic_browser.ts`,
      "utf8"
    );
    expect(semanticBrowser).toContain("defineDynamic(");
    expect(semanticBrowser).toContain("requireWorkerScope(context)");
    expect(semanticBrowser).toContain('from "@onkernel/browser-loop"');
    const workerInstructions = readFileSync(
      `${workerRoot}/instructions.md`,
      "utf8"
    );
    expect(workerInstructions).not.toContain("`inspect_autofill`");
    expect(workerInstructions).not.toContain("`final_output`");
    expect(workerInstructions).toContain(
      "structured completion tool Eve supplies"
    );
    expect(workerInstructions).toContain(
      "Never use the browser for general web search"
    );
    expect(workerInstructions).toContain(
      "never the whole page or a region spanning several options"
    );
    expect(workerInstructions).toContain(
      "A named vertical search or booking product"
    );
    expect(workerInstructions).toContain("such as Google Flights");
    expect(workerInstructions).toContain(
      "Use `playwright_execute` as the primary browser execution surface"
    );
    expect(workerInstructions).toContain(
      "Prefer one bounded program per page state"
    );
    expect(workerInstructions).toContain(
      "`browser_act` dispatches actions and returns the successor state"
    );
    expect(existsSync(`${workerRoot}/lib/browser-contract.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/lib/browser-runtime.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/lib/owned-browser.ts`)).toBe(true);

    expect(readFileSync(`${workerRoot}/lib/kernel.ts`, "utf8")).toContain(
      "new Kernel("
    );
    for (const tool of [
      "capture_browser_image",
      "computer_action",
      "manage_browsers",
    ]) {
      const source = readFileSync(`${workerTools}/${tool}.ts`, "utf8");
      expect(source).toContain(
        'from "@agent/subagents/browser-agent/lib/kernel"'
      );
      expect(source).not.toContain("new Kernel(");
    }
    expect(readFileSync(`${workerTools}/fill_from_vault.ts`, "utf8")).toContain(
      'from "../lib/autofill/native"'
    );
  });

  it("requires structured completion for initial and resumed worker calls", () => {
    const workerCoordination = readFileSync(
      "agent/instructions/content/worker-coordination.md",
      "utf8"
    );
    const workerConfig = readFileSync(`${workerRoot}/agent.ts`, "utf8");

    expect(workerCoordination).toContain(
      "tool supplies the required structured completion schema"
    );
    expect(workerCoordination).toContain(
      "including when passing an existing `taskId`"
    );
    expect(workerCoordination).toContain(
      "using the completion tool Eve supplies"
    );
    expect(workerConfig).toContain("tool: false");
    expect(workerConfig).not.toContain("outputSchema:");
  });
});

// Every tool file must state whether it can affect other people and, if so,
// that a code-level approval gates it. A new tool without an entry fails here.
// See docs/ADR-002 Approval gates and audit log.md.
const toolSafety = {
  [`${rootTools}/ask_question.ts`]: "exempt: asks the current user",
  [`${rootTools}/calendar.ts`]: "gated: calendar-create-event with attendees",
  [`${rootTools}/contacts.ts`]: "exempt: read-only",
  [`${rootTools}/gmail.ts`]:
    "gated: gmail-send; gmail-update is reversible and stays in the mailbox",
  [`${rootTools}/messaging.ts`]: "exempt: replies to the current user only",
  [`${rootTools}/run_browser.ts`]:
    "exempt: delegates to the worker, whose card fills are gated",
  [`${rootTools}/schedules.ts`]: "exempt: affects only the user's own jobs",
  [`${rootTools}/vault.ts`]: "exempt: sends the user a setup link",
  [`${rootTools}/visuals.ts`]: "exempt: draws images for the current user",
  [`${rootTools}/web_fetch.ts`]: "exempt: read-only",
  [`${rootTools}/web_search.ts`]: "exempt: read-only",
  [`${workerTools}/bash.ts`]: "exempt: disabled",
  [`${workerTools}/capture_browser_image.ts`]: "exempt: read-only",
  [`${workerTools}/computer_action.ts`]:
    "exempt: browser input; risky clicks are a known gap in ADR-002",
  [`${workerTools}/fill_from_link.ts`]: "exempt: Link approves each spend",
  [`${workerTools}/fill_from_vault.ts`]: "gated: payment card fills",
  [`${workerTools}/list_vault.ts`]: "exempt: returns safe metadata only",
  [`${workerTools}/manage_browsers.ts`]: "exempt: owned browser lifecycle",
  [`${workerTools}/personal_info.ts`]: "exempt: disabled",
  [`${workerTools}/read_file.ts`]: "exempt: sandbox read",
  [`${workerTools}/semantic_browser.ts`]:
    "exempt: browser input; risky clicks are a known gap in ADR-002",
  [`${workerTools}/web_fetch.ts`]: "exempt: read-only",
  [`${workerTools}/web_search.ts`]: "exempt: read-only",
  [`${workerTools}/write_file.ts`]: "exempt: sandbox write",
};

describe("tool safety inventory", () => {
  it("classifies every tool file as gated or exempt with a reason", () => {
    const files = [
      ...toolFiles(rootTools).map((file) => `${rootTools}/${file}`),
      ...toolFiles(workerTools).map((file) => `${workerTools}/${file}`),
    ];

    expect(Object.keys(toolSafety).toSorted()).toEqual(files.toSorted());
    for (const decision of Object.values(toolSafety)) {
      expect(decision).toMatch(/^(gated|exempt): \S/u);
    }
  });

  it("puts a code-level approval on every gated tool", () => {
    expect(gmailSend.approval).toBeDefined();
    expect(calendarCreateEvent.approval).toBeDefined();
    expect(fillFromVault.approval).toBeDefined();
  });
});
