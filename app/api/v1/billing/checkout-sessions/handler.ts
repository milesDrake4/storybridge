import type {
  CreateCheckoutSessionInput,
  CheckoutSessionResponse,
} from "@/contracts/http/v1/billing";
import { createCheckoutSessionInputSchema } from "@/contracts/http/v1/billing";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { BillingError } from "@/services/billing/create-checkout";

function safeError(error: unknown): Response {
  if (
    error instanceof BillingError ||
    error instanceof EligibilityError ||
    error instanceof RequestBoundaryError
  ) {
    return createErrorResponse(error.code);
  }
  return createErrorResponse("INTERNAL_ERROR");
}

export function createCheckoutSessionHandler(dependencies: {
  appUrl: URL;
  create(
    input: CreateCheckoutSessionInput,
    request: { idempotencyKey: string },
  ): Promise<CheckoutSessionResponse>;
}) {
  return async function postCheckoutSession(
    request: Request,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(
        request,
        createCheckoutSessionInputSchema,
      );
      return createSuccessResponse(
        await dependencies.create(input, { idempotencyKey }),
        { status: 201 },
      );
    } catch (error) {
      return safeError(error);
    }
  };
}
