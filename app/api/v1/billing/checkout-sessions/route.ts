import { createCheckoutSessionHandler } from "@/app/api/v1/billing/checkout-sessions/handler";
import { createBillingRuntime } from "@/app/api/v1/billing/checkout-sessions/runtime";
import { createCheckoutSession } from "@/services/billing/create-checkout";

export async function POST(request: Request): Promise<Response> {
  const { config, dependencies } = await createBillingRuntime();
  return createCheckoutSessionHandler({
    appUrl: config.appUrl,
    create: (input, requestMetadata) =>
      createCheckoutSession(input, requestMetadata, dependencies),
  })(request);
}
