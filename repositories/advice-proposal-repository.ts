import type {
  AiOperationId,
  AiProposalId,
  EssayId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  AdviceDraft,
  AdviceProposal,
} from "@/contracts/http/v1/proposals";

export interface AdviceProposalRepository {
  commit(input: {
    draft: AdviceDraft;
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
  }): Promise<
    | { type: "CREATED" | "REPLAY"; value: AdviceProposal }
    | { type: "NOT_FOUND" | "REVISION_MISMATCH" | "STATE_CONFLICT" }
  >;
  findById(
    userId: UserId,
    proposalId: AiProposalId,
  ): Promise<AdviceProposal | null>;
}
