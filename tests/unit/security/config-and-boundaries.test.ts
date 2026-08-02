import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { register } from "@/instrumentation";
import { parseServerConfig } from "@/lib/config/server";
import {
  createContentHmac,
  createIdempotencyHmac,
  createIpHmac,
} from "@/lib/security/hmac";
import {
  RequestBoundaryError,
  assertSameOriginMutation,
  normalizePlainText,
  readJsonBody,
} from "@/lib/security/request-boundary";

const validEnvironment = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "example-publishable-key",
  SUPABASE_SECRET_KEY: "example-server-secret",
  OPENAI_API_KEY: "example-openai-key",
  OPENAI_MODEL: "gpt-5.6-terra",
  STRIPE_SECRET_KEY: "example-stripe-secret",
  STRIPE_WEBHOOK_SECRET: "example-webhook-secret",
  STRIPE_SEASON_PASS_PRICE_ID: "price_example",
  SEASON_PASS_PRICE_CENTS: "2499",
  FREE_ESSAY_LIMIT: "1",
  PAID_ESSAY_LIMIT: "20",
  DAILY_AI_CALL_LIMIT: "50",
  BETA_ACCOUNT_CAP: "25",
  MONTHLY_OPENAI_BUDGET_CENTS: "15000",
  MAX_AI_INPUT_TOKENS: "12000",
  MAX_AI_OUTPUT_TOKENS: "4000",
  IP_HMAC_SECRET: "ip-secret-abcdefghijklmnopqrstuvwxyz-01",
  CONTENT_HMAC_SECRET: "content-secret-abcdefghijklmnopqrstuv-02",
  IDEMPOTENCY_HMAC_SECRET: "idempotency-secret-abcdefghijklmnopqr-03",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server configuration", () => {
  it("parses the complete validated environment", () => {
    const config = parseServerConfig(validEnvironment);

    expect(config.appUrl.href).toBe("http://localhost:3000/");
    expect(config.betaAccountCap).toBe(25);
    expect(config.seasonPassPriceCents).toBe(2499);
  });

  it("fails closed for missing, equal, or short HMAC secrets", () => {
    expect(() =>
      parseServerConfig({ ...validEnvironment, IP_HMAC_SECRET: undefined }),
    ).toThrow();
    expect(() =>
      parseServerConfig({ ...validEnvironment, IP_HMAC_SECRET: "short" }),
    ).toThrow();
    expect(() =>
      parseServerConfig({
        ...validEnvironment,
        CONTENT_HMAC_SECRET: validEnvironment.IP_HMAC_SECRET,
      }),
    ).toThrow();
  });

  it("fails production server startup before accepting requests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");

    await expect(register()).rejects.toThrow();
  });

  it.each([
    ["NEXT_PUBLIC_APP_URL", "javascript:alert(1)"],
    ["OPENAI_MODEL", ""],
    ["SEASON_PASS_PRICE_CENTS", "24.99"],
    ["BETA_ACCOUNT_CAP", "26"],
    ["MONTHLY_OPENAI_BUDGET_CENTS", "0"],
  ] as const)("rejects malformed %s", (key, value) => {
    expect(() =>
      parseServerConfig({ ...validEnvironment, [key]: value }),
    ).toThrow();
  });
});

describe("purpose-separated HMACs", () => {
  it("is deterministic within one purpose and distinct across purposes", () => {
    const keys = parseServerConfig(validEnvironment).hmacSecrets;
    const input = "same-sensitive-value";

    expect(createIpHmac(input, keys)).toBe(createIpHmac(input, keys));
    expect(createIpHmac(input, keys)).not.toBe(createContentHmac(input, keys));
    expect(createContentHmac(input, keys)).not.toBe(
      createIdempotencyHmac(input, keys),
    );
    expect(createIpHmac(input, keys)).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
  });
});

describe("request boundaries", () => {
  it("normalizes Unicode and line endings while rejecting control characters", () => {
    expect(normalizePlainText("Ａ\r\nline\rnext\tvalue")).toBe(
      "A\nline\nnext\tvalue",
    );
    expect(() => normalizePlainText("unsafe\u0000text")).toThrow(
      RequestBoundaryError,
    );
    expect(() => normalizePlainText("unsafe\u0085text")).toThrow(
      RequestBoundaryError,
    );
  });

  it("accepts only same-origin cookie-authenticated mutations", () => {
    const validRequest = new Request("http://localhost:3000/api/v1/essays", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });
    expect(() =>
      assertSameOriginMutation(validRequest, new URL("http://localhost:3000")),
    ).not.toThrow();

    const crossSiteRequest = new Request(
      "http://localhost:3000/api/v1/essays",
      {
        method: "POST",
        headers: { host: "localhost:3000", origin: "https://attacker.test" },
      },
    );
    expect(() =>
      assertSameOriginMutation(
        crossSiteRequest,
        new URL("http://localhost:3000"),
      ),
    ).toThrow(RequestBoundaryError);
  });

  it("parses strict JSON without reading beyond the 64 KB boundary", async () => {
    const schema = z.strictObject({ title: z.string() });
    const request = new Request("http://localhost/api/v1/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    await expect(readJsonBody(request, schema)).resolves.toEqual({
      title: "Hello",
    });

    const oversized = new Request("http://localhost/api/v1/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(65_536) }),
    });
    await expect(readJsonBody(oversized, schema)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("maps content-type, malformed JSON, and schema failures to v1 errors", async () => {
    const schema = z.strictObject({ title: z.string() });

    await expect(
      readJsonBody(
        new Request("http://localhost/api/v1/example", {
          method: "POST",
          body: "{}",
        }),
        schema,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });

    await expect(
      readJsonBody(
        new Request("http://localhost/api/v1/example", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        schema,
      ),
    ).rejects.toMatchObject({ code: "MALFORMED_JSON" });

    await expect(
      readJsonBody(
        new Request("http://localhost/api/v1/example", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Hello", unknown: true }),
        }),
        schema,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
