import { listBrowserVaultFills } from "@db/services/browsers";
import { readVaultItem, readVaultSecret } from "@db/services/vault";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  parseLoginVaultPayload,
  parsePaymentCardSecret,
} from "@shared/vault/schema";

const redacted = "[vault value]";
// Shorter secrets, such as a security code, would also match ordinary page
// text, so they are scrubbed only where a snapshot reports a field's value.
const minimumAnywhereLength = 6;

// Returns a scrubber for text from a browser that received vault fills, or
// undefined when nothing was filled. Only secrets are scrubbed: card number,
// security code, expiry, and password. Names, emails, and addresses are
// ordinary personal information the model already works with.
export async function vaultRedactionFor(
  scope: AccessScope,
  browserSessionId: string
) {
  const itemIds = await listBrowserVaultFills(scope, browserSessionId);
  if (itemIds.length === 0) return undefined;

  const secrets = (
    await Promise.all(itemIds.map((itemId) => vaultSecrets(scope, itemId)))
  ).flat();
  const rules = secrets.flatMap(redactionRules);
  return (text: string) =>
    rules.reduce(
      (current, { pattern, replacement }) =>
        current.replace(pattern, replacement),
      text
    );
}

type VaultSecret =
  | { readonly kind: "card-number"; readonly digits: string }
  | { readonly kind: "text"; readonly value: string };

async function vaultSecrets(
  scope: AccessScope,
  itemId: string
): Promise<VaultSecret[]> {
  const item = await readVaultItem(scope, itemId);
  const secret = item ? await readVaultSecret(scope, itemId) : undefined;
  if (!item || !secret) return [];

  if (item.kind === "payment") {
    const card = parsePaymentCardSecret(secret);
    const month = String(card.expirationMonth).padStart(2, "0");
    const year = String(card.expirationYear);
    return [
      { digits: card.number, kind: "card-number" },
      ...[
        card.securityCode,
        `${month}/${year.slice(-2)}`,
        `${month}/${year}`,
        `${month}${year.slice(-2)}`,
      ].map((value) => ({ kind: "text" as const, value })),
    ];
  }
  if (item.kind === "login") {
    const login = parseLoginVaultPayload(secret);
    return login?.authentication.type === "password"
      ? [{ kind: "text", value: login.authentication.password }]
      : [];
  }
  return [];
}

function redactionRules(secret: VaultSecret) {
  // A card number may be shown with spaces or dashes between digits.
  if (secret.kind === "card-number") {
    return [
      {
        pattern: new RegExp(secret.digits.split("").join("[\\s-]?"), "gu"),
        replacement: redacted,
      },
    ];
  }
  const { value } = secret;
  // Snapshots report a field as value="...", which is also JSON-escaped
  // when the snapshot is nested inside structured output.
  const fieldValue = {
    pattern: new RegExp(
      `value=(\\\\?")${escapeRegex(JSON.stringify(value).slice(1, -1))}\\\\?"`,
      "gu"
    ),
    replacement: `value=$1${redacted}$1`,
  };
  if (value.length < minimumAnywhereLength) return [fieldValue];
  return [
    ...new Set([
      value,
      JSON.stringify(value).slice(1, -1),
      encodeURIComponent(value),
    ]),
  ].map((variant) => ({
    pattern: new RegExp(escapeRegex(variant), "gu"),
    replacement: redacted,
  }));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
