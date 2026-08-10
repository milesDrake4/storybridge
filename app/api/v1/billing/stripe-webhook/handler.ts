import {
  StripeWebhookPayloadError,
  StripeWebhookSignatureError,
} from "@/adapters/stripe/webhook";
import {
  readRawJsonBody,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";

const MAX_STRIPE_WEBHOOK_BYTES = 256 * 1_024;

export function createStripeWebhookHandler(dependencies: {
  process(
    rawBody: Uint8Array,
    signatureHeader: string,
  ): Promise<"ACKNOWLEDGED" | "RETRY">;
}) {
  return async function postStripeWebhook(request: Request): Promise<Response> {
    try {
      const signature = request.headers.get("stripe-signature");
      if (!signature) return new Response(null, { status: 400 });
      const rawBody = await readRawJsonBody(request, MAX_STRIPE_WEBHOOK_BYTES);
      const decision = await dependencies.process(rawBody, signature);
      return new Response(null, {
        status: decision === "ACKNOWLEDGED" ? 200 : 500,
      });
    } catch (error) {
      const badRequest =
        error instanceof RequestBoundaryError ||
        error instanceof StripeWebhookPayloadError ||
        error instanceof StripeWebhookSignatureError;
      return new Response(null, {
        status: badRequest ? 400 : 500,
      });
    }
  };
}
