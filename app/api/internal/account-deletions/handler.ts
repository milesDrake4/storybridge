import { timingSafeEqual } from "node:crypto";

import type { AccountDeletionWorkerResult } from "@/services/privacy/process-account-deletion";

export function authorizedInternalRequest(
  request: Request,
  secret: string,
): boolean {
  const authorization = request.headers.get("authorization");
  const expected = `Bearer ${secret}`;
  if (!authorization || authorization.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

export function createAccountDeletionWorkerHandler(dependencies: {
  processNext(): Promise<AccountDeletionWorkerResult>;
  secret?: string;
}) {
  return async function processAccountDeletion(request: Request) {
    if (!dependencies.secret) {
      return new Response(null, {
        headers: { "cache-control": "no-store" },
        status: 503,
      });
    }
    if (!authorizedInternalRequest(request, dependencies.secret)) {
      return new Response(null, {
        headers: { "cache-control": "no-store" },
        status: 401,
      });
    }
    const result = await dependencies.processNext();
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    );
  };
}
