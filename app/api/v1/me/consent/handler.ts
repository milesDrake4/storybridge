import {
  consentInputSchema,
  type ConsentInput,
  type Profile,
} from "@/contracts/http/v1/me";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";

type ConsentPutDependencies = {
  appUrl: URL;
  consent(input: ConsentInput): Promise<Profile>;
};

export function createConsentPutHandler(dependencies: ConsentPutDependencies) {
  return async function putConsent(request: Request): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const input = await readJsonBody(request, consentInputSchema);
      const profile = await dependencies.consent(input);
      return createSuccessResponse(profile);
    } catch (error) {
      if (error instanceof RequestBoundaryError) {
        return createErrorResponse(error.code);
      }
      if (error instanceof EligibilityError) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
