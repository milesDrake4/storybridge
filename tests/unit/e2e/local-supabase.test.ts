import { describe, expect, it } from "vitest";

import {
  buildInvitedAdultRecords,
  parseSupabaseStatusEnvironment,
  toPlaywrightStorageState,
} from "../../../e2e/support/local-supabase";

describe("local Supabase E2E support", () => {
  it("selects current local API keys without retaining unrelated secrets", () => {
    const environment = parseSupabaseStatusEnvironment(`
API_URL="http://127.0.0.1:54321"
DB_URL="unrelated-value-that-must-not-be-retained"
PUBLISHABLE_KEY="sb_publishable_local"
SECRET_KEY="sb_secret_local"
`);

    expect(environment).toEqual({
      publishableKey: "sb_publishable_local",
      secretKey: "sb_secret_local",
      supabaseUrl: "http://127.0.0.1:54321",
    });
    expect(environment).not.toHaveProperty("DB_URL");
  });

  it("supports legacy local key names and values containing equals signs", () => {
    const environment = parseSupabaseStatusEnvironment(`
API_URL=http://127.0.0.1:54321
ANON_KEY="header.payload.signature=="
SERVICE_ROLE_KEY="service.payload.signature=="
`);

    expect(environment.publishableKey).toBe("header.payload.signature==");
    expect(environment.secretKey).toBe("service.payload.signature==");
  });

  it("fails closed when required local values are absent", () => {
    expect(() =>
      parseSupabaseStatusEnvironment('API_URL="http://127.0.0.1:54321"'),
    ).toThrow("Local Supabase status is missing required E2E values.");
  });

  it("refuses to provision against a non-loopback Supabase project", () => {
    expect(() =>
      parseSupabaseStatusEnvironment(`
API_URL="https://project.supabase.co"
PUBLISHABLE_KEY="publishable"
SECRET_KEY="secret"
`),
    ).toThrow("E2E session provisioning requires local Supabase.");
  });

  it("maps SSR cookies to host-only Playwright storage without exposing origins", () => {
    const state = toPlaywrightStorageState(
      [
        {
          name: "sb-local-auth-token",
          options: {
            httpOnly: true,
            maxAge: 3600,
            path: "/",
            sameSite: "lax",
            secure: false,
          },
          value: "session-value",
        },
      ],
      new URL("http://127.0.0.1:3100"),
      1_785_700_000,
    );

    expect(state).toEqual({
      cookies: [
        {
          domain: "127.0.0.1",
          expires: 1_785_703_600,
          httpOnly: true,
          name: "sb-local-auth-token",
          path: "/",
          sameSite: "Lax",
          secure: false,
          value: "session-value",
        },
      ],
      origins: [],
    });
  });

  it("builds only the accepted invitation and current adult profile needed by the access gate", () => {
    const records = buildInvitedAdultRecords({
      emailHmac: `v1.${"a".repeat(43)}`,
      now: new Date("2026-08-03T13:00:00.000Z"),
      userId: "e0000000-0000-4000-8000-000000000001",
    });

    expect(records).toEqual({
      invitation: {
        accepted_user_id: "e0000000-0000-4000-8000-000000000001",
        expires_at: "2026-08-04T13:00:00.000Z",
        normalized_email_hmac: `v1.${"a".repeat(43)}`,
        status: "ACCEPTED",
      },
      profile: {
        age_confirmed_at: "2026-08-03T13:00:00.000Z",
        birth_year: 2000,
        consented_at: "2026-08-03T13:00:00.000Z",
        onboarding_state: "IN_PROGRESS",
        privacy_version: "privacy-2026-08-02",
        responsible_use_version: "responsible-use-2026-08-02",
        terms_version: "terms-2026-08-02",
        user_id: "e0000000-0000-4000-8000-000000000001",
      },
    });
  });
});
