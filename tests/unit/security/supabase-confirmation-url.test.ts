import { describe, expect, it } from "vitest";

import { parseSupabaseConfirmationUrl } from "@/lib/security/supabase-confirmation-url";

const appUrl = new URL("https://storybridge.test");
const supabaseUrl = new URL("https://project.supabase.co");

describe("parseSupabaseConfirmationUrl", () => {
  it("accepts a magic-link verification URL bound to the app callback", () => {
    const confirmationUrl =
      "https://project.supabase.co/auth/v1/verify?token=token-hash&type=magiclink&redirect_to=https%3A%2F%2Fstorybridge.test%2Fapi%2Fv1%2Fauth%2Fcallback";

    expect(
      parseSupabaseConfirmationUrl(confirmationUrl, { appUrl, supabaseUrl })
        ?.href,
    ).toBe(confirmationUrl);
  });

  it("reconstructs parameters split out by the nested email-template URL", () => {
    expect(
      parseSupabaseConfirmationUrl(
        "https://project.supabase.co/auth/v1/verify?token=token-hash",
        {
          appUrl,
          redirectTo: "https://storybridge.test/api/v1/auth/callback",
          supabaseUrl,
          type: "magiclink",
        },
      )?.searchParams.get("redirect_to"),
    ).toBe("https://storybridge.test/api/v1/auth/callback");
  });

  it.each([
    "https://evil.test/auth/v1/verify?token=token-hash&type=magiclink&redirect_to=https%3A%2F%2Fstorybridge.test%2Fapi%2Fv1%2Fauth%2Fcallback",
    "https://project.supabase.co/auth/v1/verify?token=token-hash&type=magiclink&redirect_to=https%3A%2F%2Fevil.test%2Fapi%2Fv1%2Fauth%2Fcallback",
    "https://project.supabase.co/auth/v1/verify?token=token-hash&type=recovery&redirect_to=https%3A%2F%2Fstorybridge.test%2Fapi%2Fv1%2Fauth%2Fcallback",
  ])("rejects an untrusted confirmation target: %s", (confirmationUrl) => {
    expect(
      parseSupabaseConfirmationUrl(confirmationUrl, { appUrl, supabaseUrl }),
    ).toBeNull();
  });
});
