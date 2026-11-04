import { describe, expect, it } from "vitest";
import {
  isSignInRequest,
  parseSignInLinkFragment,
  signInLinkPath,
  signInRequestUri,
} from "@shared/identity/sign-in-link";

describe("sign-in by text", () => {
  it("recognizes the request however it is capitalized or punctuated", () => {
    for (const text of [
      "Sign me in",
      "sign me in",
      " SIGN ME IN! ",
      "Sign me in.",
    ]) {
      expect(isSignInRequest(text)).toBe(true);
    }
    for (const text of ["Sign me in to Resy", "sign in", "Please sign me in"]) {
      expect(isSignInRequest(text)).toBe(false);
    }
  });

  it("opens Messages to the number with the request typed", () => {
    expect(signInRequestUri("+12025550199")).toBe(
      "sms:+12025550199?&body=Sign%20me%20in"
    );
  });

  it("keeps the code in the link fragment and reads it back", () => {
    const path = signInLinkPath("+12025550123", "123456");

    expect(path.startsWith("/sign-in-link#")).toBe(true);
    expect(new URL(path, "https://example.com").search).toBe("");
    expect(
      parseSignInLinkFragment(new URL(path, "https://example.com").hash)
    ).toEqual({
      code: "123456",
      phone: "+12025550123",
    });
  });

  it("rejects an incomplete or malformed link", () => {
    expect(parseSignInLinkFragment("")).toBeUndefined();
    expect(parseSignInLinkFragment("#code=123456")).toBeUndefined();
    expect(
      parseSignInLinkFragment("#code=abc&phone=%2B12025550123")
    ).toBeUndefined();
    expect(
      parseSignInLinkFragment("#code=123456&phone=2025550123")
    ).toBeUndefined();
  });
});
