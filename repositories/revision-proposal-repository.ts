import type {
  AiOperationId,
  AiProposalId,
  EssayId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  ContinuationDraft,
  ContinuationProposal,
  RewriteDraft,
  RewriteInstruction,
  RewriteProposal,
} from "@/contracts/http/v1/proposals";

type CommitMetadata = {
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
};

type CommitResult<T> =
  | { type: "CREATED" | "REPLAY"; value: T }
  | { type: "NOT_FOUND" | "REVISION_MISMATCH" | "STATE_CONFLICT" };

export interface RevisionProposalRepository {
  commitContinuation(
    input: CommitMetadata & {
      contextHash: string;
      cursorOffset: number;
      draft: ContinuationDraft;
    },
  ): Promise<CommitResult<ContinuationProposal>>;
  commitRewrite(
    input: CommitMetadata & {
      draft: RewriteDraft;
      instruction: RewriteInstruction;
      selection: { end: number; start: number; textHash: string };
    },
  ): Promise<CommitResult<RewriteProposal>>;
  findContinuationById(
    userId: UserId,
    proposalId: AiProposalId,
  ): Promise<ContinuationProposal | null>;
  findRewriteById(
    userId: UserId,
    proposalId: AiProposalId,
  ): Promise<RewriteProposal | null>;
}
