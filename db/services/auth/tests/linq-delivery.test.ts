/* oxlint-disable vitest/require-mock-type-parameters -- The connector mock needs only the token operation exercised here. */
import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock("@vercel/connect", () => ({ getToken: mocks.getToken }));

const linqApiErrorSchema = z.object({
  code: z.string(),
  linqError: z.object({
    code: z.number(),
    message: z.string(),
    status: z.number(),
    trace_id: z.string(),
  }),
  message: z.string(),
});

describe("Linq phone authentication", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("texts the code with a one-tap link that keeps the code out of the request", async () => {
    vi.stubEnv("LINQ_CONNECTOR", "linq/open-instinct");
    mocks.getToken.mockResolvedValue("test-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendPhoneCode } = await import("@db/services/auth");
    await sendPhoneCode({ code: "123456", to: "+12025550123" });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const { message } = z
      .object({
        message: z.object({
          parts: z.array(z.object({ value: z.string() })),
        }),
      })
      .parse(JSON.parse(z.string().parse(init?.body)));
    const text = message.parts[0]?.value ?? "";
    expect(text).toContain("sign-in code: 123456");
    expect(text).toContain(
      "https://example.com/sign-in-link#code=123456&phone=%2B12025550123"
    );
  });

  it("preserves provider diagnostics and returns actionable client copy", async () => {
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "0123456789abcdefghijklmnopqrstuvwxyzABCD"
    );
    vi.stubEnv("LINQ_CONNECTOR", "linq/open-instinct");
    mocks.getToken.mockResolvedValue("test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 2015,
              message: "no eligible sending line available",
              status: 409,
            },
            success: false,
            trace_id: "trace-123",
          },
          { status: 409 }
        )
      )
    );

    const { sendPhoneCode } = await import("@db/services/auth");
    const error: unknown = await sendPhoneCode({
      code: "123456",
      to: "+12025550123",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(APIError);
    if (!(error instanceof APIError)) throw new TypeError("Expected APIError");

    const body = linqApiErrorSchema.parse(error.body);
    expect(body).toMatchObject({
      code: "LINQ_SENDING_LINE_UNAVAILABLE",
      linqError: {
        code: 2015,
        message: "no eligible sending line available",
        status: 409,
        trace_id: "trace-123",
      },
    });
    expect(body.message).toContain("line's health");
  });
});
