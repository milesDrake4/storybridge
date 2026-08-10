import { requestIdSchema, rfc3339UtcSchema } from "@/contracts/http/v1/common";
import {
  API_VERSION,
  type ApiSuccess,
  type FieldError,
} from "@/contracts/http/v1/envelopes";
import {
  type ErrorCode,
  errorStatusByCode,
  isRetryableError,
  publicErrorMessageByCode,
} from "@/contracts/http/v1/errors";
import { serverLogger } from "@/lib/observability/logger";
import { alertForApplicationError } from "@/services/observability/alerts";

type SuccessHttpStatus = 200 | 201 | 202;

type ResponseOptions = {
  headers?: HeadersInit;
  requestId?: string;
};

type SuccessResponseOptions = ResponseOptions & {
  status?: SuccessHttpStatus;
};

type ErrorResponseOptions = ResponseOptions & {
  fieldErrors?: FieldError[];
  followUpQuestion?: string;
  resetAt?: string;
};

function resolveRequestId(requestId: string | undefined): string {
  return requestIdSchema.parse(requestId ?? crypto.randomUUID());
}

function createJsonHeaders(
  requestId: string,
  initialHeaders: HeadersInit | undefined,
): Headers {
  const headers = new Headers(initialHeaders);
  headers.set("cache-control", "private, no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-request-id", requestId);
  return headers;
}

export function createSuccessResponse<T>(
  data: T,
  options: SuccessResponseOptions = {},
): Response {
  const requestId = resolveRequestId(options.requestId);
  const body: ApiSuccess<T> = {
    apiVersion: API_VERSION,
    data,
    meta: { requestId },
  };

  return new Response(JSON.stringify(body), {
    headers: createJsonHeaders(requestId, options.headers),
    status: options.status ?? 200,
  });
}

export function createErrorResponse(
  code: ErrorCode,
  options: ErrorResponseOptions = {},
): Response {
  const requestId = resolveRequestId(options.requestId);
  const resetAt = options.resetAt
    ? rfc3339UtcSchema.parse(options.resetAt)
    : undefined;
  const body = {
    apiVersion: API_VERSION,
    error: {
      code,
      message: publicErrorMessageByCode[code],
      retryable: isRetryableError(code),
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
      ...(options.followUpQuestion
        ? { followUpQuestion: options.followUpQuestion }
        : {}),
      ...(resetAt ? { resetAt } : {}),
    },
    meta: { requestId },
  };

  if (process.env.NODE_ENV === "production") {
    serverLogger.write({
      errorCode: code,
      event: "request_failed",
      level: errorStatusByCode[code] >= 500 ? "error" : "warn",
      requestId,
    });
    const alert = alertForApplicationError(code, requestId);
    if (alert) serverLogger.write(alert);
  }

  return new Response(JSON.stringify(body), {
    headers: createJsonHeaders(requestId, options.headers),
    status: errorStatusByCode[code],
  });
}
