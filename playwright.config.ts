import { defineConfig, devices } from "@playwright/test";

import { discoverLocalSupabaseEnvironment } from "./e2e/support/local-supabase";

const port = 3100;
const localSupabase = (() => {
  try {
    return discoverLocalSupabaseEnvironment();
  } catch {
    return undefined;
  }
})();
const testServerEnvironment = {
  BETA_ACCOUNT_CAP: "25",
  CONTENT_HMAC_SECRET: "test-content-hmac-secret-00000000002",
  DAILY_AI_CALL_LIMIT: "50",
  FREE_ESSAY_LIMIT: "1",
  IDEMPOTENCY_HMAC_SECRET: "test-idempotency-hmac-secret-000003",
  INTERNAL_OPERATIONS_SECRET: "test-operations-secret-00000000000004",
  IP_HMAC_SECRET: "test-ip-hmac-secret-000000000000001",
  MAX_AI_INPUT_TOKENS: "12000",
  MAX_AI_OUTPUT_TOKENS: "4000",
  MONTHLY_OPENAI_BUDGET_CENTS: "15000",
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.E2E_SUPABASE_PUBLISHABLE_KEY ??
    localSupabase?.publishableKey ??
    "test-publishable-key",
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.E2E_SUPABASE_URL ??
    localSupabase?.supabaseUrl ??
    "https://test.supabase.co",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.6-terra",
  AI_PROVIDER_MODE: "mock",
  PAID_ESSAY_LIMIT: "20",
  SEASON_PASS_PRICE_CENTS: "2499",
  STRIPE_SEASON_PASS_PRICE_ID: "price_test",
  STRIPE_SECRET_KEY: "test-stripe-secret",
  STRIPE_WEBHOOK_SECRET: "test-stripe-webhook-secret",
  SUPABASE_SECRET_KEY:
    process.env.E2E_SUPABASE_SECRET_KEY ??
    localSupabase?.secretKey ??
    "test-supabase-secret",
  VERCEL_ENV: "preview",
} as const;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "off",
    trace: process.env.CI ? "off" : "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    env: testServerEnvironment,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
