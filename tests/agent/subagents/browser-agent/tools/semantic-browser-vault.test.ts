import type * as EveTools from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as WorkerAccess from "@agent/subagents/browser-agent/lib/access";
import * as Redaction from "@agent/subagents/browser-agent/lib/autofill/redaction";
import * as OwnedBrowser from "@agent/subagents/browser-agent/lib/owned-browser";
import * as SemanticLoop from "@agent/subagents/browser-agent/lib/semantic-loop";
import * as Browsers from "@db/services/browsers";
import {
  dynamicContextFor,
  dynamicTool,
  evaluateDynamic,
  withEvaluableDynamic,
} from "@tests/helpers/dynamic";
import { toolContextFor } from "@tests/helpers/tool-context";

vi.mock("eve/tools", async (importOriginal) =>
  withEvaluableDynamic(await importOriginal<typeof EveTools>())
);

import semanticBrowser from "@agent/subagents/browser-agent/tools/semantic_browser";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const access = vi.spyOn(WorkerAccess, "requireWorkerScope");
const owned = vi.spyOn(OwnedBrowser, "requireOwnedBrowserSession");
const execute = vi.spyOn(SemanticLoop, "executeBrowserLoopTool");
const fills = vi.spyOn(Browsers, "listBrowserVaultFills");
const redaction = vi.spyOn(Redaction, "vaultRedactionFor");

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue(scope);
  owned.mockResolvedValue({
    createdAt: "2026-10-01T00:00:00Z",
    sessionId: "browser-1",
    workerSessionId: "worker-1",
  });
  fills.mockResolvedValue([]);
  redaction.mockResolvedValue(undefined);
});

describe("semantic browser tools after a vault fill", () => {
  it("denies page scripts in a browser that has a vault fill", async () => {
    const approval = await playwrightApproval();

    expect(await approval(approvalContext("playwright_execute"))).toBe(
      "not-applicable"
    );

    fills.mockResolvedValue(["card-1"]);
    expect(await approval(approvalContext("playwright_execute"))).toEqual({
      reason:
        "playwright_execute is unavailable in a browser that has a vault fill. Use browser_snapshot, browser_find, and browser_act instead.",
      type: "denied",
    });
    expect(fills).toHaveBeenLastCalledWith(scope, "browser-1");
  });

  it("leaves other browser tools ungated", async () => {
    const approval = await playwrightApproval();
    fills.mockResolvedValue(["card-1"]);

    expect(await approval(approvalContext("browser_snapshot"))).toBe(
      "not-applicable"
    );
  });

  it("scrubs vault values from snapshot text and details", async () => {
    execute.mockResolvedValue({
      content: [
        { text: 'textbox "Card" [value="4242424242424242"]', type: "text" },
      ],
      details: {
        readResults: [{ value: "4242424242424242" }],
        statusText: "ok",
      },
    });
    redaction.mockResolvedValue((text) =>
      text.replaceAll("4242424242424242", "[vault value]")
    );

    const snapshot = await snapshotTool();
    const result = await snapshot.execute(
      { session_id: "browser-1" },
      toolContextFor({ toolName: "browser_snapshot" })
    );

    expect(JSON.stringify(result)).not.toContain("4242424242424242");
    expect(result).toEqual({
      content: [
        { text: 'textbox "Card" [value="[vault value]"]', type: "text" },
      ],
      details: {
        readResults: [{ value: "[vault value]" }],
        statusText: "ok",
      },
    });
    expect(redaction).toHaveBeenCalledWith(scope, "browser-1");
  });
});

describe("semantic browser model output", () => {
  it("caps a large page result so later steps do not reread all of it", async () => {
    const page = "x".repeat(50_000);
    const tool = dynamicTool(await resolvedTools(), "playwright_execute");

    const output = tool.toModelOutput?.({
      content: [{ text: page, type: "text" }],
      details: { statusText: "ok" },
    });

    const text = JSON.stringify(output);
    expect(text.length).toBeLessThan(17_000);
    expect(text).toContain("[truncated 34000 characters]");
  });
});

async function resolvedTools() {
  return evaluateDynamic(semanticBrowser, dynamicContextFor());
}

async function playwrightApproval() {
  const approval = dynamicTool(
    await resolvedTools(),
    "playwright_execute"
  ).approval;
  if (!(approval instanceof Function)) {
    throw new Error("Expected a playwright_execute approval policy.");
  }
  return approval;
}

async function snapshotTool() {
  return dynamicTool(await resolvedTools(), "browser_snapshot");
}

function approvalContext(toolName: string) {
  return {
    ...toolContextFor({ toolName }),
    toolInput: { session_id: "browser-1" },
  };
}
