function requireValue(environment, name, failures) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${name} is required`);
    return "";
  }
  return value;
}

export function validateDeploymentEnvironment(environment) {
  const failures = [];
  const target = requireValue(
    environment,
    "DEPLOYMENT_VALIDATION_TARGET",
    failures,
  );
  if (target !== "preview" && target !== "production") {
    failures.push("DEPLOYMENT_VALIDATION_TARGET must be preview or production");
  }

  const aiMode = requireValue(environment, "AI_PROVIDER_MODE", failures);
  const openAiKey = requireValue(environment, "OPENAI_API_KEY", failures);
  const stripeKey = requireValue(environment, "STRIPE_SECRET_KEY", failures);
  const stripeWebhook = requireValue(
    environment,
    "STRIPE_WEBHOOK_SECRET",
    failures,
  );
  const supabaseUrl = requireValue(
    environment,
    "NEXT_PUBLIC_SUPABASE_URL",
    failures,
  );
  const previewRef = requireValue(
    environment,
    "PREVIEW_SUPABASE_PROJECT_REF",
    failures,
  );
  const productionRef = requireValue(
    environment,
    "PRODUCTION_SUPABASE_PROJECT_REF",
    failures,
  );

  if (previewRef && productionRef && previewRef === productionRef) {
    failures.push("preview and production Supabase project refs must differ");
  }
  if (target === "preview") {
    if (environment.VERCEL_ENV && environment.VERCEL_ENV !== "preview") {
      failures.push("VERCEL_ENV must be preview");
    }
    if (aiMode !== "mock")
      failures.push("preview AI_PROVIDER_MODE must be mock");
    if (openAiKey.startsWith("sk-")) {
      failures.push("preview mock mode must not contain a live OpenAI key");
    }
    if (!stripeKey.startsWith("sk_test_")) {
      failures.push("preview Stripe key must use test mode");
    }
    if (!stripeWebhook.startsWith("whsec_")) {
      failures.push("preview Stripe webhook secret must be scoped test data");
    }
    if (previewRef && supabaseUrl && !supabaseUrl.includes(previewRef)) {
      failures.push("preview Supabase URL must match its isolated project ref");
    }
  }

  if (target === "production") {
    if (environment.VERCEL_ENV && environment.VERCEL_ENV !== "production") {
      failures.push("VERCEL_ENV must be production");
    }
    if (aiMode !== "live")
      failures.push("production AI_PROVIDER_MODE must be live");
    if (!openAiKey.startsWith("sk-")) {
      failures.push("production OpenAI key is not a live provider key");
    }
    if (!stripeKey.startsWith("sk_live_")) {
      failures.push("production Stripe key must use live mode");
    }
    if (productionRef && supabaseUrl && !supabaseUrl.includes(productionRef)) {
      failures.push("production Supabase URL must match its project ref");
    }
    if (environment.BETA_ACCOUNT_CAP !== "25") {
      failures.push("production BETA_ACCOUNT_CAP must be 25");
    }
    if (environment.MONTHLY_OPENAI_BUDGET_CENTS !== "15000") {
      failures.push("production monthly AI ceiling must be USD 150");
    }
  }

  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = validateDeploymentEnvironment(process.env);
  if (failures.length) {
    console.error("Deployment environment validation failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Deployment environment contract passed without printing values.",
    );
  }
}
