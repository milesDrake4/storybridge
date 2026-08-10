import type { BillingEntitlement } from "@/contracts/http/v1/billing";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import { EligibilityError } from "@/services/auth/eligibility";

export function createBillingEntitlementGetHandler(dependencies: {
  get(): Promise<BillingEntitlement>;
}) {
  return async function getBillingEntitlement(request: Request) {
    void request;
    try {
      return createSuccessResponse(await dependencies.get());
    } catch (error) {
      if (error instanceof EligibilityError) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
