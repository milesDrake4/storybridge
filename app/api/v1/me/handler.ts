import { deleteAccountInputSchema } from "@/contracts/http/v1/me";
import type {
  AccountDeletionStatusResponse,
  AccountExport,
  DeletionRequest,
} from "@/contracts/http/v1/me";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { AccountLifecycleError } from "@/services/privacy/delete-account";
import { AccountExportError } from "@/services/privacy/export-account";

function safeError(error: unknown): Response {
  if (
    error instanceof AccountExportError ||
    error instanceof AccountLifecycleError ||
    error instanceof EligibilityError ||
    error instanceof RequestBoundaryError
  ) {
    return createErrorResponse(error.code);
  }
  return createErrorResponse("INTERNAL_ERROR");
}

export function createDeleteAccountHandler(dependencies: {
  appUrl: URL;
  deleteAccount(idempotencyKey: string): Promise<DeletionRequest>;
}) {
  return async function deleteAccount(request: Request): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      await readJsonBody(request, deleteAccountInputSchema, 256);
      return createSuccessResponse(
        await dependencies.deleteAccount(idempotencyKey),
        { status: 202 },
      );
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createAccountExportHandler(dependencies: {
  exportAccount(): Promise<AccountExport>;
}) {
  return async function getAccountExport(): Promise<Response> {
    try {
      const accountExport = await dependencies.exportAccount();
      const date = accountExport.exportedAt.slice(0, 10);
      return new Response(JSON.stringify(accountExport), {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="storybridge-data-${date}.json"`,
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
        status: 200,
      });
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createAccountDeletionStatusHandler(dependencies: {
  getStatus(statusToken: string): Promise<AccountDeletionStatusResponse>;
}) {
  return async function getAccountDeletionStatus(
    request: Request,
  ): Promise<Response> {
    const authorization = request.headers.get("authorization");
    const match = /^DeletionStatus ([A-Za-z0-9_-]+)$/.exec(authorization ?? "");
    if (!match?.[1]) return createErrorResponse("AUTH_REQUIRED");
    try {
      return createSuccessResponse(await dependencies.getStatus(match[1]));
    } catch (error) {
      return safeError(error);
    }
  };
}
