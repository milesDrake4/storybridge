import { isIP } from "node:net";

import { magicLinkRequestSchema } from "@/contracts/http/v1/auth";
import type { HmacSecrets } from "@/lib/config/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  createEmailHmac,
  createInvitationTokenHmac,
  createIpHmac,
} from "@/lib/security/hmac";
import {
  readJsonBody,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import type {
  RequestMagicLinkInput,
  RequestMagicLinkResult,
} from "@/services/auth/request-magic-link";

type MagicLinkRequestService = (
  input: RequestMagicLinkInput,
) => Promise<RequestMagicLinkResult>;

type MagicLinkPostDependencies = {
  appUrl: URL;
  hmacSecrets: HmacSecrets;
  now?: () => Date;
  requestMagicLink: MagicLinkRequestService;
};

function clientIp(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",", 1)[0];
  const candidate = forwarded?.trim();
  return candidate && candidate.length <= 128 && isIP(candidate)
    ? candidate
    : "unknown";
}

function rateLimitHeaders(
  result: Extract<RequestMagicLinkResult, { type: "RATE_LIMITED" }>,
  now: Date,
): HeadersInit {
  const resetSeconds = Math.floor(result.decision.resetAt.getTime() / 1_000);
  const retryAfter = Math.max(
    0,
    Math.ceil((result.decision.resetAt.getTime() - now.getTime()) / 1_000),
  );
  return {
    "RateLimit-Limit": String(result.decision.limit),
    "RateLimit-Remaining": String(result.decision.remaining),
    "RateLimit-Reset": String(resetSeconds),
    "Retry-After": String(retryAfter),
  };
}

export function createMagicLinkPostHandler(
  dependencies: MagicLinkPostDependencies,
) {
  return async function postMagicLink(request: Request): Promise<Response> {
    try {
      const input = await readJsonBody(request, magicLinkRequestSchema);
      const now = dependencies.now?.() ?? new Date();
      const result = await dependencies.requestMagicLink({
        email: input.email,
        emailHmac: createEmailHmac(input.email, dependencies.hmacSecrets),
        ...(input.inviteToken
          ? {
              inviteTokenHmac: createInvitationTokenHmac(
                input.inviteToken,
                dependencies.hmacSecrets,
              ),
            }
          : {}),
        ipHmac: createIpHmac(clientIp(request), dependencies.hmacSecrets, now),
        redirectTo: new URL("/api/v1/auth/callback", dependencies.appUrl).href,
      });

      if (result.type === "RATE_LIMITED") {
        return createErrorResponse("RATE_LIMITED", {
          headers: rateLimitHeaders(result, now),
          resetAt: result.decision.resetAt.toISOString(),
        });
      }
      return createSuccessResponse(result.value, { status: 202 });
    } catch (error) {
      if (error instanceof RequestBoundaryError) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
