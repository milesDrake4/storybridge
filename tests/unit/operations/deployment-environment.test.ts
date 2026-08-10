import { describe, expect, it } from "vitest";

import { validateDeploymentEnvironment } from "@/scripts/validate-deployment-environment.mjs";

const preview = {
  AI_PROVIDER_MODE: "mock",
  DEPLOYMENT_VALIDATION_TARGET: "preview",
  NEXT_PUBLIC_SUPABASE_URL: "https://previewabcdefghijkl.supabase.co",
  OPENAI_API_KEY: "mock-disabled",
  PREVIEW_SUPABASE_PROJECT_REF: "previewabcdefghijkl",
  PRODUCTION_SUPABASE_PROJECT_REF: "productionabcdefghijk",
  STRIPE_SECRET_KEY: "sk_test_ci_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_preview_placeholder",
  VERCEL_ENV: "preview",
} as const;

describe("deployment environment contract", () => {
  it("accepts an isolated preview with disabled provider calls", () => {
    expect(validateDeploymentEnvironment(preview)).toEqual([]);
  });

  it("rejects production data or live provider keys in preview", () => {
    expect(
      validateDeploymentEnvironment({
        ...preview,
        AI_PROVIDER_MODE: "live",
        NEXT_PUBLIC_SUPABASE_URL: "https://productionabcdefghijk.supabase.co",
        OPENAI_API_KEY: "sk-proj-live-secret",
        STRIPE_SECRET_KEY: "sk_live_secret",
      }),
    ).toEqual(
      expect.arrayContaining([
        "preview AI_PROVIDER_MODE must be mock",
        "preview mock mode must not contain a live OpenAI key",
        "preview Stripe key must use test mode",
        "preview Supabase URL must match its isolated project ref",
      ]),
    );
  });

  it("requires the launch cap and budget in production", () => {
    expect(
      validateDeploymentEnvironment({
        ...preview,
        AI_PROVIDER_MODE: "live",
        BETA_ACCOUNT_CAP: "26",
        DEPLOYMENT_VALIDATION_TARGET: "production",
        MONTHLY_OPENAI_BUDGET_CENTS: "15001",
        NEXT_PUBLIC_SUPABASE_URL: "https://productionabcdefghijk.supabase.co",
        OPENAI_API_KEY: "sk-proj-live-secret",
        STRIPE_SECRET_KEY: "sk_live_secret",
        VERCEL_ENV: "production",
      }),
    ).toEqual(
      expect.arrayContaining([
        "production BETA_ACCOUNT_CAP must be 25",
        "production monthly AI ceiling must be USD 150",
      ]),
    );
  });
});
