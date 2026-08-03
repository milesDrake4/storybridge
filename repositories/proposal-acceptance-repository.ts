import type { AiProposalId, EssayId, UserId } from "@/contracts/domain/ids";
import type { Essay } from "@/contracts/http/v1/essays";
import type { ContentHmac, IdempotencyHmac } from "@/lib/security/hmac";

export interface ProposalAcceptanceRepository {
  accept(input: {
    essayId: EssayId;
    expectedCurrentDraft: string;
    expectedRevision: number;
    idempotencyKeyHmac: IdempotencyHmac;
    nextDraft: string;
    now: Date;
    proposalId: AiProposalId;
    requestHmac: ContentHmac;
    userId: UserId;
  }): Promise<
    | { type: "ACCEPTED" | "REPLAY"; value: Essay }
    | {
        type:
          | "IDEMPOTENCY_KEY_REUSED"
          | "NOT_FOUND"
          | "PROPOSAL_NOT_ACCEPTABLE"
          | "REVISION_MISMATCH"
          | "STATE_CONFLICT";
      }
  >;
  replay(input: {
    idempotencyKeyHmac: IdempotencyHmac;
    requestHmac: ContentHmac;
    userId: UserId;
  }): Promise<
    { type: "REPLAY"; value: Essay } | { type: "IDEMPOTENCY_KEY_REUSED" } | null
  >;
}
