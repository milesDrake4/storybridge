import { createStripeWebhookHandler } from "@/app/api/v1/billing/stripe-webhook/handler";
import { createStripeWebhookRuntime } from "@/app/api/v1/billing/stripe-webhook/runtime";
import { processStripeWebhook } from "@/services/billing/process-webhook";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const dependencies = createStripeWebhookRuntime();
  return createStripeWebhookHandler({
    process: (rawBody, signatureHeader) =>
      processStripeWebhook(rawBody, signatureHeader, dependencies),
  })(request);
}
