import type {
  AiOperationId,
  AiProposalId,
  EssayId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  ReferenceClaimDraft,
  ReferenceDraftProposal,
} from "@/contracts/http/v1/reference-drafts";
import type { ContentHmac } from "@/lib/security/hmac";

export type PersistedReferenceClaim = ReferenceClaimDraft & {
  contentHmac: ContentHmac;
};

export type CommitReferenceDraftDecision =
  | { type: "CREATED" | "REPLAY"; value: ReferenceDraftProposal }
  | {
      type:
        | "EVIDENCE_INVALID"
        | "NOT_FOUND"
        | "REVISION_MISMATCH"
        | "STATE_CONFLICT";
    };

export interface ReferenceDraftRepository {
  commit(input: {
    acknowledgmentVersion: string;
    claims: PersistedReferenceClaim[];
    essayId: EssayId;
    finalCostCents: number;
    inputTokens: number;
    latencyMs: number;
    modelId: string;
    now: Date;
    operationId: AiOperationId;
    outputTokens: number;
    providerRequestId: string;
    rationale: string;
    referenceText: string;
    targetRevision: number;
    userId: UserId;
  }): Promise<CommitReferenceDraftDecision>;
  findById(
    userId: UserId,
    proposalId: AiProposalId,
  ): Promise<ReferenceDraftProposal | null>;
}
