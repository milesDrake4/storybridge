import type {
  AiOperationId,
  AiProposalId,
  EssayAngleId,
  EssayId,
  SchoolDossierId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  OutlineProposal,
  OutlineProposalDraft,
} from "@/contracts/http/v1/outlines";

export type CommitOutlineProposalDecision =
  | { type: "CREATED" | "REPLAY"; value: OutlineProposal }
  | {
      type:
        | "EVIDENCE_INVALID"
        | "NOT_FOUND"
        | "REVISION_MISMATCH"
        | "STATE_CONFLICT";
    };

export interface OutlineProposalRepository {
  commit(input: {
    angleId: EssayAngleId;
    dossierId: SchoolDossierId;
    draft: OutlineProposalDraft;
    essayId: EssayId;
    finalCostCents: number;
    inputTokens: number;
    latencyMs: number;
    modelId: string;
    now: Date;
    operationId: AiOperationId;
    outputTokens: number;
    providerRequestId: string;
    targetRevision: number;
    userId: UserId;
  }): Promise<CommitOutlineProposalDecision>;
  findById(
    userId: UserId,
    proposalId: AiProposalId,
  ): Promise<OutlineProposal | null>;
}
