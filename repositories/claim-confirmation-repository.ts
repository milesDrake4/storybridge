import type { EssayId, ProposalClaimId, UserId } from "@/contracts/domain/ids";
import type {
  ClaimConfirmation,
  ClaimDecisionInput,
} from "@/contracts/http/v1/reference-drafts";
import type { ContentHmac, IdempotencyHmac } from "@/lib/security/hmac";

export type ClaimDecisionResult =
  | { type: "DECIDED" | "REPLAY"; value: ClaimConfirmation }
  | {
      type: "IDEMPOTENCY_KEY_REUSED" | "NOT_FOUND" | "STATE_CONFLICT";
    };

export interface ClaimConfirmationRepository {
  decide(input: {
    claimId: ProposalClaimId;
    decision: ClaimDecisionInput["decision"];
    essayId: EssayId;
    idempotencyKeyHmac: IdempotencyHmac;
    now: Date;
    requestHmac: ContentHmac;
    userId: UserId;
  }): Promise<ClaimDecisionResult>;
}
