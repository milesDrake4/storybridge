import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const testServerEnvironment = {
  BETA_ACCOUNT_CAP: "25",
  CONTENT_HMAC_SECRET: "test-content-hmac-secret-00000000002",
  DAILY_AI_CALL_LIMIT: "50",
  FREE_ESSAY_LIMIT: "1",
  IDEMPOTENCY_HMAC_SECRET: "test-idempotency-hmac-secret-000003",
  IP_HMAC_SECRET: "test-ip-hmac-secret-000000000000001",
  MAX_AI_INPUT_TOKENS: "12000",
  MAX_AI_OUTPUT_TOKENS: "4000",
  MONTHLY_OPENAI_BUDGET_CENTS: "15000",
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.6-terra",
  PAID_ESSAY_LIMIT: "20",
  SEASON_PASS_PRICE_CENTS: "2499",
  STRIPE_SEASON_PASS_PRICE_ID: "price_test",
  STRIPE_SECRET_KEY: "test-stripe-secret",
  STRIPE_WEBHOOK_SECRET: "test-stripe-webhook-secret",
  SUPABASE_SECRET_KEY: "test-supabase-secret",
} as const;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
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
