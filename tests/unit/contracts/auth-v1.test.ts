import { describe, expect, it } from "vitest";

import {
  authCallbackQuerySchema,
  magicLinkAcceptedSchema,
  magicLinkRequestSchema,
} from "@/contracts/http/v1/auth";

describe("HTTP v1 authentication contracts", () => {
  it("normalizes valid email addresses and bounds invitation tokens", () => {
    expect(
      magicLinkRequestSchema.parse({
        email: "  Student@Example.COM  ",
        inviteToken: "invite_123",
      }),
    ).toEqual({
      email: "student@example.com",
      inviteToken: "invite_123",
    });

    expect(
      magicLinkRequestSchema.safeParse({
        email: "student@example.com",
        inviteToken: "x".repeat(257),
      }).success,
    ).toBe(false);
  });

  it("rejects malformed addresses and unknown request fields", () => {
    expect(
      magicLinkRequestSchema.safeParse({ email: "not-an-email" }).success,
    ).toBe(false);
    expect(
      magicLinkRequestSchema.safeParse({
        email: "student@example.com",
        admin: true,
      }).success,
    ).toBe(false);
  });

  it("accepts bounded provider codes and relative callback destinations", () => {
    expect(
      authCallbackQuerySchema.parse({ code: "single-use-code", next: "/app" }),
    ).toEqual({ code: "single-use-code", next: "/app" });

    for (const next of [
      "https://evil.test",
      "//evil.test",
      "app",
      "/app\\evil",
    ]) {
      expect(
        authCallbackQuerySchema.safeParse({ code: "single-use-code", next })
          .success,
      ).toBe(false);
    }
  });

  it("defines the intentionally uniform accepted response", () => {
    expect(magicLinkAcceptedSchema.parse({ accepted: true })).toEqual({
      accepted: true,
    });
    expect(magicLinkAcceptedSchema.safeParse({ accepted: false }).success).toBe(
      false,
    );
  });
});
