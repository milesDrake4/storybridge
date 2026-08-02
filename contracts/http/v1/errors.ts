import { z } from "zod";

export const errorCodes = [
  "MALFORMED_JSON",
  "INVALID_CONTENT_TYPE",
  "INVALID_QUERY",
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "CONSENT_REQUIRED",
  "INVITATION_REQUIRED",
  "BETA_AGE_RESTRICTED",
  "RESOURCE_NOT_FOUND",
  "IDEMPOTENCY_KEY_REUSED",
  "STATE_CONFLICT",
  "PROPOSAL_NOT_ACCEPTABLE",
  "EXPORT_BLOCKED",
  "REVISION_MISMATCH",
  "VALIDATION_ERROR",
  "UNSUPPORTED_SCHOOL",
  "INSUFFICIENT_EVIDENCE",
  "PROMPT_PRIVACY_RISK",
  "REVISION_REQUIRED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "BETA_CAP_REACHED",
  "PROVIDER_INVALID_RESPONSE",
  "PROVIDER_REFUSED",
  "AI_BUDGET_EXHAUSTED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export type ErrorHttpStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 412
  | 422
  | 428
  | 429
  | 500
  | 502
  | 503;

export const errorStatusByCode = {
  MALFORMED_JSON: 400,
  INVALID_CONTENT_TYPE: 400,
  INVALID_QUERY: 400,
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  CONSENT_REQUIRED: 403,
  INVITATION_REQUIRED: 403,
  BETA_AGE_RESTRICTED: 403,
  RESOURCE_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  STATE_CONFLICT: 409,
  PROPOSAL_NOT_ACCEPTABLE: 409,
  EXPORT_BLOCKED: 409,
  REVISION_MISMATCH: 412,
  VALIDATION_ERROR: 422,
  UNSUPPORTED_SCHOOL: 422,
  INSUFFICIENT_EVIDENCE: 422,
  PROMPT_PRIVACY_RISK: 422,
  REVISION_REQUIRED: 428,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  BETA_CAP_REACHED: 429,
  PROVIDER_INVALID_RESPONSE: 502,
  PROVIDER_REFUSED: 502,
  AI_BUDGET_EXHAUSTED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, ErrorHttpStatus>;

export const publicErrorMessageByCode = {
  MALFORMED_JSON: "The request body is not valid JSON.",
  INVALID_CONTENT_TYPE: "The request content type is not supported.",
  INVALID_QUERY: "The request query is invalid.",
  AUTH_REQUIRED: "Sign in is required.",
  SESSION_EXPIRED: "The session has expired. Sign in again.",
  CONSENT_REQUIRED: "Current consent is required.",
  INVITATION_REQUIRED: "A valid beta invitation is required.",
  BETA_AGE_RESTRICTED: "The closed beta is limited to adults.",
  RESOURCE_NOT_FOUND: "The requested resource was not found.",
  IDEMPOTENCY_KEY_REUSED:
    "The idempotency key was already used for another request.",
  STATE_CONFLICT: "The request conflicts with the current resource state.",
  PROPOSAL_NOT_ACCEPTABLE: "The proposal can no longer be accepted.",
  EXPORT_BLOCKED: "Export is blocked until the identified issues are resolved.",
  REVISION_MISMATCH: "The resource has changed. Reload it and try again.",
  VALIDATION_ERROR: "The request contains invalid values.",
  UNSUPPORTED_SCHOOL: "The selected school is not supported.",
  INSUFFICIENT_EVIDENCE: "More verified evidence is required.",
  PROMPT_PRIVACY_RISK: "Remove personal or essay content from the prompt.",
  REVISION_REQUIRED: "A current resource revision is required.",
  IDEMPOTENCY_KEY_REQUIRED: "An idempotency key is required.",
  RATE_LIMITED: "Too many requests. Try again later.",
  QUOTA_EXCEEDED: "The current usage limit has been reached.",
  BETA_CAP_REACHED: "The closed beta has reached its current capacity.",
  PROVIDER_INVALID_RESPONSE: "The requested operation could not be completed.",
  PROVIDER_REFUSED: "The requested operation could not be completed.",
  AI_BUDGET_EXHAUSTED: "AI assistance is temporarily unavailable.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
  INTERNAL_ERROR: "An unexpected error occurred.",
} as const satisfies Record<ErrorCode, string>;

const retryableErrorCodes = new Set<ErrorCode>([
  "RATE_LIMITED",
  "PROVIDER_INVALID_RESPONSE",
  "AI_BUDGET_EXHAUSTED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export function isRetryableError(code: ErrorCode): boolean {
  return retryableErrorCodes.has(code);
}
