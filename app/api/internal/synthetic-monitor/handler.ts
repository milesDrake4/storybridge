import { authorizedInternalRequest } from "@/app/api/internal/account-deletions/handler";
import { requestIdSchema } from "@/contracts/http/v1/common";
import type { StructuredLogger } from "@/lib/observability/logger";
import { runSyntheticMonitor } from "@/services/observability/synthetic-monitor";

export function createSyntheticMonitorHandler(dependencies: {
  logger: StructuredLogger;
  secret?: string;
}) {
  return async function syntheticMonitor(request: Request): Promise<Response> {
    if (
      !dependencies.secret ||
      !authorizedInternalRequest(request, dependencies.secret)
    ) {
      return new Response(null, {
        headers: { "cache-control": "no-store" },
        status: dependencies.secret ? 401 : 503,
      });
    }
    const suppliedRequestId = requestIdSchema.safeParse(
      request.headers.get("x-request-id"),
    );
    const requestId = suppliedRequestId.success
      ? suppliedRequestId.data
      : requestIdSchema.parse(crypto.randomUUID());
    await runSyntheticMonitor(
      {
        check: "ERROR_PIPELINE",
        probe: () => Promise.reject(new Error("SYNTHETIC_ERROR_PIPELINE_TEST")),
      },
      { logger: dependencies.logger, requestId },
    );
    return Response.json(
      { accepted: true },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
        status: 202,
      },
    );
  };
}
