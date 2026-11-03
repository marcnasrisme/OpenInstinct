import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approval } from "eve/tools/approval";
import * as WorkerAccess from "@agent/subagents/browser-agent/lib/access";
import * as OwnedBrowser from "@agent/subagents/browser-agent/lib/owned-browser";
import * as Autofill from "@agent/subagents/browser-agent/lib/autofill/native";
import * as AutofillService from "@agent/subagents/browser-agent/lib/autofill/service";
import * as Vault from "@db/services/vault";
import fillFromVault from "@agent/subagents/browser-agent/tools/fill_from_vault";
import { toolContextFor } from "@tests/helpers/tool-context";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const context = toolContextFor({
  parentSessionId: "root-1",
  toolName: "fill_from_vault",
});
const cardInput = {
  browserSessionId: "browser-1",
  candidateId: "card-1",
  declaredTotal: { amountMinor: 2306, currency: "usd" },
  expectedOrigin: "https://shop.example/checkout",
};
const access = vi.spyOn(WorkerAccess, "requireWorkerScope");
const owned = vi.spyOn(OwnedBrowser, "requireOwnedBrowserSession");
const origin = vi.spyOn(Autofill, "currentKernelPageOrigin");
const fill = vi.spyOn(Autofill, "fillWithKernelNativeAutofill");
const claims = vi.spyOn(AutofillService, "materializeAutofillClaims");
const readItem = vi.spyOn(Vault, "readVaultItem");

function vaultItem(kind: "address" | "login" | "payment") {
  return {
    account: "",
    createdAt: "2026-10-01T00:00:00Z",
    id: "card-1",
    kind,
    label: "Visa",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue(scope);
  owned.mockResolvedValue({
    createdAt: "2026-10-01T00:00:00Z",
    sessionId: "browser-1",
    workerSessionId: "worker-1",
  });
  readItem.mockResolvedValue(vaultItem("payment"));
});

describe("fill_from_vault approval", () => {
  it("asks before filling a saved card and shows the merchant and total", async () => {
    const approval = approvalConfiguration(fillFromVault.approval);

    expect(await approval.request({ ...context, toolInput: cardInput })).toBe(
      "user-approval"
    );
    expect(readItem).toHaveBeenCalledExactlyOnceWith(scope, "card-1");
    expect(
      approval.prompt?.({
        callId: "call-1",
        input: cardInput,
        toolName: "fill_from_vault",
      })
    ).toBe(
      [
        "Fill a saved card for this purchase?",
        "Merchant: https://shop.example",
        "Total: $23.06",
      ].join("\n")
    );
  });

  it("denies a card fill without a declared total", async () => {
    const approval = approvalConfiguration(fillFromVault.approval);
    const { declaredTotal: _omitted, ...withoutTotal } = cardInput;

    expect(
      await approval.request({ ...context, toolInput: withoutTotal })
    ).toEqual({
      reason:
        "A payment card fill requires declaredTotal with the checkout total.",
      type: "denied",
    });
  });

  it("fills addresses and logins without an approval", async () => {
    const approval = approvalConfiguration(fillFromVault.approval);

    readItem.mockResolvedValueOnce(vaultItem("address"));
    expect(await approval.request({ ...context, toolInput: cardInput })).toBe(
      "not-applicable"
    );
    readItem.mockResolvedValueOnce(vaultItem("login"));
    expect(await approval.request({ ...context, toolInput: cardInput })).toBe(
      "not-applicable"
    );
  });

  it("fails closed without validated input", async () => {
    const approval = approvalConfiguration(fillFromVault.approval);

    expect(await approval.request({ ...context, toolInput: undefined })).toBe(
      "user-approval"
    );
    expect(readItem).not.toHaveBeenCalled();
  });

  it("formats totals in the currency's own minor units", () => {
    const approval = approvalConfiguration(fillFromVault.approval);

    expect(
      approval.prompt?.({
        callId: "call-1",
        input: {
          ...cardInput,
          declaredTotal: { amountMinor: 1500, currency: "jpy" },
        },
        toolName: "fill_from_vault",
      })
    ).toContain("Total: ¥1,500");
  });
});

describe("fill_from_vault execution", () => {
  it("fills nothing when the page is on another origin", async () => {
    origin.mockResolvedValue("https://evil.example");

    await expect(fillFromVault.execute(cardInput, context)).rejects.toThrow(
      "The page is on https://evil.example, not the expected https://shop.example. Nothing was filled."
    );
    expect(claims).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });
});

function approvalConfiguration<TInput>(approval: Approval<TInput> | undefined) {
  if (!approval || !("request" in approval)) {
    throw new Error("Expected an approval configuration with a prompt.");
  }
  return approval;
}
