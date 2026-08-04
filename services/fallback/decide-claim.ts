import type { EssayId, ProposalClaimId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type {
  ClaimConfirmation,
  ClaimDecisionInput,
} from "@/contracts/http/v1/reference-drafts";
import type { HmacSecrets } from "@/lib/config/server";
import { createContentHmac, createIdempotencyHmac } from "@/lib/security/hmac";
import type { ClaimConfirmationRepository } from "@/repositories/claim-confirmation-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type ClaimDecisionErrorCode = Extract<
  ErrorCode,
  | "IDEMPOTENCY_KEY_REUSED"
  | "RESOURCE_NOT_FOUND"
  | "STATE_CONFLICT"
  | "VALIDATION_ERROR"
>;

export class ClaimDecisionError extends Error {
  readonly code: ClaimDecisionErrorCode;
  constructor(code: ClaimDecisionErrorCode) {
    super(code);
    this.name = "ClaimDecisionError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  claimConfirmations: ClaimConfirmationRepository;
  hmacSecrets: HmacSecrets;
};

export async function decideReferenceClaim(
  essayId: EssayId,
  claimId: ProposalClaimId,
  input: ClaimDecisionInput,
  request: { idempotencyKey: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<ClaimConfirmation> {
  if (input.decision !== "CONFIRM" && input.decision !== "REJECT") {
    throw new ClaimDecisionError("VALIDATION_ERROR");
  }
  const { userId } = await requireProductEligibility(dependencies, now);
  const canonicalRequest = JSON.stringify({
    claimId,
    decision: input.decision,
    essayId,
  });
  const result = await dependencies.claimConfirmations.decide({
    claimId,
    decision: input.decision,
    essayId,
    idempotencyKeyHmac: createIdempotencyHmac(
      request.idempotencyKey,
      dependencies.hmacSecrets,
    ),
    now,
    requestHmac: createContentHmac(canonicalRequest, dependencies.hmacSecrets),
    userId,
  });
  if (result.type === "DECIDED" || result.type === "REPLAY") {
    return result.value;
  }
  const codeByDecision = {
    IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
    NOT_FOUND: "RESOURCE_NOT_FOUND",
    STATE_CONFLICT: "STATE_CONFLICT",
  } as const;
  throw new ClaimDecisionError(codeByDecision[result.type]);
}
