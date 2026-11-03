import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Browsers from "@db/services/browsers";
import * as Vault from "@db/services/vault";
import { vaultRedactionFor } from "@agent/subagents/browser-agent/lib/autofill/redaction";
import { serializeLoginVaultPayload } from "@shared/vault/schema";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const fills = vi.spyOn(Browsers, "listBrowserVaultFills");
const readItem = vi.spyOn(Vault, "readVaultItem");
const readSecret = vi.spyOn(Vault, "readVaultSecret");

const card = JSON.stringify({
  billingPostalCode: "02139",
  cardholderName: "Ada Lovelace",
  expirationMonth: 7,
  expirationYear: 2031,
  kind: "payment-card",
  number: "4242424242424242",
  securityCode: "123",
  version: 1,
});
const login = serializeLoginVaultPayload({
  authentication: { password: 'p"ss word&1', type: "password" },
  identifier: { type: "email", value: "ada@example.com" },
  kind: "login",
  origin: "https://shop.example",
  version: 2,
});

function vaultItem(id: string, kind: "login" | "payment") {
  return {
    account: "",
    createdAt: "2026-10-01T00:00:00Z",
    id,
    kind,
    label: kind,
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fills.mockResolvedValue(["card-1", "login-1"]);
  readItem.mockImplementation(async (_scope, id) =>
    vaultItem(id, id === "card-1" ? "payment" : "login")
  );
  readSecret.mockImplementation(async (_scope, id) =>
    id === "card-1" ? card : login
  );
});

describe("vault redaction", () => {
  it("does nothing for a browser without vault fills", async () => {
    fills.mockResolvedValue([]);

    expect(await vaultRedactionFor(scope, "browser-1")).toBeUndefined();
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("scrubs a card number however the page formats it", async () => {
    const redact = await requireRedaction();

    expect(redact('textbox "Card number" [value="4242424242424242"]')).toBe(
      'textbox "Card number" [value="[vault value]"]'
    );
    expect(redact("Card 4242 4242 4242 4242 and 4242-4242-4242-4242")).toBe(
      "Card [vault value] and [vault value]"
    );
    expect(redact("Visa ending in 4242")).toBe("Visa ending in 4242");
  });

  it("scrubs the security code and expiry only where a field reports them", async () => {
    const redact = await requireRedaction();

    expect(redact('textbox "CVC" [value="123"]')).toBe(
      'textbox "CVC" [value="[vault value]"]'
    );
    expect(redact('{"text":"textbox \\"Expiry\\" [value=\\"07/31\\"]"}')).toBe(
      '{"text":"textbox \\"Expiry\\" [value=\\"[vault value]\\"]"}'
    );
    expect(redact("Order 123 ships 07/31")).toBe("Order 123 ships 07/31");
  });

  it("scrubs a password in plain, JSON-escaped, and URL-encoded forms", async () => {
    const redact = await requireRedaction();

    expect(redact('typed p"ss word&1')).toBe("typed [vault value]");
    expect(redact(JSON.stringify({ value: 'p"ss word&1' }))).toBe(
      '{"value":"[vault value]"}'
    );
    expect(redact(`?pw=${encodeURIComponent('p"ss word&1')}`)).toBe(
      "?pw=[vault value]"
    );
  });

  it("keeps ordinary personal information visible", async () => {
    const redact = await requireRedaction();

    expect(redact("Signed in as ada@example.com, ZIP 02139")).toBe(
      "Signed in as ada@example.com, ZIP 02139"
    );
  });

  it("skips a filled item that was deleted from the vault", async () => {
    readItem.mockResolvedValue(undefined);

    const redact = await requireRedaction();

    expect(redact("4242424242424242")).toBe("4242424242424242");
  });
});

async function requireRedaction() {
  const redact = await vaultRedactionFor(scope, "browser-1");
  if (!redact) throw new Error("Expected a redaction for a filled browser.");
  return redact;
}
