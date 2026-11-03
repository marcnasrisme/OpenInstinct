import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { readVaultItem } from "@db/services/vault";
import { kernel } from "@agent/subagents/browser-agent/lib/kernel";
import {
  currentKernelPageOrigin,
  fillWithKernelNativeAutofill,
  nativeAutofillTokens,
} from "../lib/autofill/native";
import { vaultAutofillProvider } from "../lib/autofill/provider";
import { materializeAutofillClaims } from "../lib/autofill/service";

const inputSchema = z.object({
  browserSessionId: z.string().trim().min(1).max(500),
  candidateId: z.string().trim().min(1).max(500),
  declaredTotal: z
    .object({
      amountMinor: z.number().int().nonnegative(),
      currency: z
        .string()
        .regex(/^[a-z]{3}$/u)
        .describe("Lowercase ISO 4217 code, such as usd."),
    })
    .optional()
    .describe(
      "Required for a payment card: the checkout total, including tax and shipping, in minor units."
    ),
  expectedOrigin: z
    .url()
    .describe(
      "Exact origin of the page being filled, such as https://shop.example. The fill is refused when the page differs."
    ),
});

const outputSchema = z.object({
  filledClaims: z.number().int().nonnegative(),
  kind: z.enum(["address", "contact", "login", "payment"]),
  origin: z.string(),
  success: z.literal(true),
});

export default defineTool({
  // A saved card is the purchase choke point: once it is in the page, the
  // purchase is one ordinary click. The user approves the merchant and total
  // first, and execute refuses any other origin.
  approval: {
    async request(context) {
      const input = context.toolInput;
      if (!input) return "user-approval";
      const item = await readVaultItem(
        await requireWorkerScope(context),
        input.candidateId
      );
      if (item?.kind !== "payment") return "not-applicable";
      if (!input.declaredTotal) {
        return {
          type: "denied",
          reason:
            "A payment card fill requires declaredTotal with the checkout total.",
        };
      }
      return "user-approval";
    },
    prompt: ({ input }) =>
      [
        "Fill a saved card for this purchase?",
        `Merchant: ${new URL(input.expectedOrigin).origin}`,
        ...(input.declaredTotal
          ? [`Total: ${formatMinorAmount(input.declaredTotal)}`]
          : []),
      ].join("\n"),
  },
  description:
    "Fill a login, card, contact, traveler, or address form with an opaque handle returned by list_vault. Focus one control in the intended form first. Supply the page's exact expectedOrigin, and for a payment card the checkout declaredTotal; the user approves card fills. Never supply vault fields, selectors, or secret values.",
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);

    await requireOwnedBrowserSession(scope, input.browserSessionId);
    const item = await readVaultItem(scope, input.candidateId);
    if (!item) throw new Error("The selected vault item was not found.");
    if (
      item.kind !== "address" &&
      item.kind !== "contact" &&
      item.kind !== "login" &&
      item.kind !== "payment"
    ) {
      throw new Error(
        "Native browser autofill currently supports only logins, cards, contacts, and addresses."
      );
    }
    if (item.kind === "login") {
      const browser = await kernel.browsers.retrieve(
        input.browserSessionId,
        {},
        { signal: context.abortSignal }
      );
      if (!browser.profile_save_changes) {
        throw new Error(
          "Login autofill requires a browser created with save_changes: true. Delete this browser, create a writable browser at the same URL, then focus and fill again."
        );
      }
    }

    const origin = await currentKernelPageOrigin({
      browserSessionId: input.browserSessionId,
      signal: context.abortSignal,
    });
    const expectedOrigin = new URL(input.expectedOrigin).origin;
    if (origin !== expectedOrigin) {
      throw new Error(
        `The page is on ${origin}, not the expected ${expectedOrigin}. Nothing was filled.`
      );
    }
    const surfaceKind =
      item.kind === "payment"
        ? "payment-card"
        : item.kind === "login"
          ? "credentials"
          : item.kind === "contact"
            ? "contact"
            : "postal-address";
    const tokens = nativeAutofillTokens[item.kind];
    const surface = {
      fields: tokens.map((token) => ({ score: 100, token })),
      id: surfaceKind,
      kind: surfaceKind,
    };

    const claims = await materializeAutofillClaims(
      scope,
      input.candidateId,
      {
        availableTokens: new Set(tokens),
        origin,
        surface,
      },
      vaultAutofillProvider
    );
    const result = await fillWithKernelNativeAutofill({
      browserSessionId: input.browserSessionId,
      claims,
      expectedOrigin: origin,
      kind: item.kind,
      signal: context.abortSignal,
    });

    return {
      filledClaims: result.filledClaims,
      kind: item.kind,
      origin: result.origin,
      success: true as const,
    };
  },
});

function formatMinorAmount({
  amountMinor,
  currency,
}: {
  readonly amountMinor: number;
  readonly currency: string;
}) {
  const format = new Intl.NumberFormat("en-US", {
    currency: currency.toUpperCase(),
    style: "currency",
  });
  const fractionDigits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountMinor / 10 ** fractionDigits);
}
