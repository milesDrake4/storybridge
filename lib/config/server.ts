import { z } from "zod";

const positiveIntegerString = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().safe());

const nonNegativeIntegerString = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/)
  .transform(Number)
  .pipe(z.number().int().safe());

export function parseSeasonPassPriceCents(value: unknown): number {
  return positiveIntegerString.parse(value);
}

const appUrlSchema = z
  .string()
  .url()
  .transform((value, context) => {
    const url = new URL(value);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !isLocalHttp) {
      context.addIssue({ code: "custom", message: "App URL must use HTTPS" });
      return z.NEVER;
    }
    return url;
  });

const supabaseUrlSchema = z
  .string()
  .url()
  .transform((value, context) => {
    const url = new URL(value);
    const isLoopbackHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !isLoopbackHttp) {
      context.addIssue({
        code: "custom",
        message: "URL must use HTTPS or loopback HTTP",
      });
      return z.NEVER;
    }
    return url;
  });

const hmacSecretSchema = z
  .string()
  .refine(
    (value) => new TextEncoder().encode(value).byteLength >= 32,
    "HMAC secrets must contain at least 32 bytes",
  );

const rawServerConfigSchema = z
  .object({
    NEXT_PUBLIC_APP_URL: appUrlSchema,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrlSchema,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SECRET_KEY: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().trim().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    STRIPE_SEASON_PASS_PRICE_ID: z.string().startsWith("price_").min(7),
    SEASON_PASS_PRICE_CENTS: positiveIntegerString,
    FREE_ESSAY_LIMIT: nonNegativeIntegerString,
    PAID_ESSAY_LIMIT: positiveIntegerString,
    DAILY_AI_CALL_LIMIT: positiveIntegerString,
    BETA_ACCOUNT_CAP: positiveIntegerString.pipe(z.number().max(25)),
    MONTHLY_OPENAI_BUDGET_CENTS: positiveIntegerString,
    MAX_AI_INPUT_TOKENS: positiveIntegerString,
    MAX_AI_OUTPUT_TOKENS: positiveIntegerString,
    IP_HMAC_SECRET: hmacSecretSchema,
    CONTENT_HMAC_SECRET: hmacSecretSchema,
    IDEMPOTENCY_HMAC_SECRET: hmacSecretSchema,
    ACCOUNT_DELETION_WORKER_SECRET: hmacSecretSchema.optional(),
  })
  .superRefine((config, context) => {
    const secrets = [
      config.IP_HMAC_SECRET,
      config.CONTENT_HMAC_SECRET,
      config.IDEMPOTENCY_HMAC_SECRET,
      config.ACCOUNT_DELETION_WORKER_SECRET,
    ].filter((value): value is string => value !== undefined);
    if (new Set(secrets).size !== secrets.length) {
      context.addIssue({
        code: "custom",
        message: "HMAC secrets must be distinct",
        path: ["IP_HMAC_SECRET"],
      });
    }
  });

export type HmacSecrets = {
  content: string;
  idempotency: string;
  ip: string;
};

export type ServerConfig = ReturnType<typeof parseServerConfig>;

export function parseServerConfig(environment: Record<string, unknown>) {
  const config = rawServerConfigSchema.parse(environment);

  return {
    accountDeletionWorkerSecret: config.ACCOUNT_DELETION_WORKER_SECRET,
    appUrl: config.NEXT_PUBLIC_APP_URL,
    betaAccountCap: config.BETA_ACCOUNT_CAP,
    dailyAiCallLimit: config.DAILY_AI_CALL_LIMIT,
    freeEssayLimit: config.FREE_ESSAY_LIMIT,
    hmacSecrets: {
      content: config.CONTENT_HMAC_SECRET,
      idempotency: config.IDEMPOTENCY_HMAC_SECRET,
      ip: config.IP_HMAC_SECRET,
    } satisfies HmacSecrets,
    maxAiInputTokens: config.MAX_AI_INPUT_TOKENS,
    maxAiOutputTokens: config.MAX_AI_OUTPUT_TOKENS,
    monthlyOpenAiBudgetCents: config.MONTHLY_OPENAI_BUDGET_CENTS,
    openAiApiKey: config.OPENAI_API_KEY,
    openAiModel: config.OPENAI_MODEL,
    paidEssayLimit: config.PAID_ESSAY_LIMIT,
    seasonPassPriceCents: config.SEASON_PASS_PRICE_CENTS,
    stripePriceId: config.STRIPE_SEASON_PASS_PRICE_ID,
    stripeSecretKey: config.STRIPE_SECRET_KEY,
    stripeWebhookSecret: config.STRIPE_WEBHOOK_SECRET,
    supabasePublishableKey: config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: config.SUPABASE_SECRET_KEY,
    supabaseUrl: config.NEXT_PUBLIC_SUPABASE_URL,
  } as const;
}
