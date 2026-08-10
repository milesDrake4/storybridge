import {
  StripeWebhookPayloadError,
  StripeWebhookSignatureError,
} from "@/adapters/stripe/webhook";
import {
  readRawJsonBody,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { requestIdSchema } from "@/contracts/http/v1/common";
import type { StructuredLogger } from "@/lib/observability/logger";
import { createWebhookRetryAlert } from "@/services/observability/alerts";

const MAX_STRIPE_WEBHOOK_BYTES = 256 * 1_024;

export function createStripeWebhookHandler(dependencies: {
  logger?: StructuredLogger;
  process(
    rawBody: Uint8Array,
    signatureHeader: string,
  ): Promise<"ACKNOWLEDGED" | "RETRY">;
}) {
  return async function postStripeWebhook(request: Request): Promise<Response> {
    const parsedRequestId = requestIdSchema.safeParse(
      request.headers.get("x-request-id"),
    );
    const requestId = parsedRequestId.success
      ? parsedRequestId.data
      : requestIdSchema.parse(crypto.randomUUID());
    try {
      const signature = request.headers.get("stripe-signature");
      if (!signature) {
        dependencies.logger?.write({
          errorCode: "VALIDATION_ERROR",
          event: "request_failed",
          level: "warn",
          requestId,
        });
        return new Response(null, {
          headers: { "x-request-id": requestId },
          status: 400,
        });
      }
      const rawBody = await readRawJsonBody(request, MAX_STRIPE_WEBHOOK_BYTES);
      const decision = await dependencies.process(rawBody, signature);
      if (decision === "RETRY") {
        dependencies.logger?.write(createWebhookRetryAlert(requestId));
      }
      return new Response(null, {
        headers: { "x-request-id": requestId },
        status: decision === "ACKNOWLEDGED" ? 200 : 500,
      });
    } catch (error) {
      const badRequest =
        error instanceof RequestBoundaryError ||
        error instanceof StripeWebhookPayloadError ||
        error instanceof StripeWebhookSignatureError;
      dependencies.logger?.write({
        errorCode: badRequest ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
        event: "request_failed",
        level: badRequest ? "warn" : "error",
        requestId,
      });
      return new Response(null, {
        headers: { "x-request-id": requestId },
        status: badRequest ? 400 : 500,
      });
    }
  };
}
