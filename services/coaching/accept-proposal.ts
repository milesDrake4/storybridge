import type { AiProposalId, EssayId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { Essay } from "@/contracts/http/v1/essays";
import type { HmacSecrets } from "@/lib/config/server";
import {
  applyContinuationProposal,
  applyRewriteProposal,
  sliceByCodePoints,
} from "@/lib/essay/apply-proposal";
import { createContentHmac, createIdempotencyHmac } from "@/lib/security/hmac";
import { createDraftTextHash } from "@/lib/security/draft-hash";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { ProposalAcceptanceRepository } from "@/repositories/proposal-acceptance-repository";
import type { RevisionProposalRepository } from "@/repositories/revision-proposal-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type AcceptanceErrorCode = Extract<
  ErrorCode,
  | "IDEMPOTENCY_KEY_REUSED"
  | "PROPOSAL_NOT_ACCEPTABLE"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_MISMATCH"
  | "STATE_CONFLICT"
>;

export class ProposalAcceptanceError extends Error {
  readonly code: AcceptanceErrorCode;
  constructor(code: AcceptanceErrorCode) {
    super(code);
    this.name = "ProposalAcceptanceError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  acceptance: ProposalAcceptanceRepository;
  essays: EssayWorkspaceRepository;
  hmacSecrets: HmacSecrets;
  revisionProposals: RevisionProposalRepository;
};

function hasBlockingClaims(
  proposal:
    | NonNullable<
        Awaited<ReturnType<RevisionProposalRepository["findRewriteById"]>>
      >
    | NonNullable<
        Awaited<ReturnType<RevisionProposalRepository["findContinuationById"]>>
      >,
): boolean {
  const claims =
    proposal.kind === "REWRITE"
      ? proposal.claims
      : proposal.suggestions.flatMap((suggestion) => suggestion.claims);
  return claims.some((claim) => claim.status === "BLOCKING_UNSUPPORTED");
}

export async function acceptProposal(
  essayId: EssayId,
  proposalId: AiProposalId,
  expectedRevision: number,
  request: { idempotencyKey: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<Essay> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const idempotencyKeyHmac = createIdempotencyHmac(
    request.idempotencyKey,
    dependencies.hmacSecrets,
  );
  const requestHmac = createContentHmac(
    JSON.stringify({ essayId, expectedRevision, proposalId }),
    dependencies.hmacSecrets,
  );
  const replay = await dependencies.acceptance.replay({
    idempotencyKeyHmac,
    requestHmac,
    userId,
  });
  if (replay?.type === "REPLAY") return replay.value;
  if (replay?.type === "IDEMPOTENCY_KEY_REUSED") {
    throw new ProposalAcceptanceError("IDEMPOTENCY_KEY_REUSED");
  }
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace) throw new ProposalAcceptanceError("RESOURCE_NOT_FOUND");
  if (workspace.essay.revision !== expectedRevision) {
    throw new ProposalAcceptanceError("REVISION_MISMATCH");
  }
  const rewrite = await dependencies.revisionProposals.findRewriteById(
    userId,
    proposalId,
  );
  const proposal =
    rewrite ??
    (await dependencies.revisionProposals.findContinuationById(
      userId,
      proposalId,
    ));
  if (!proposal || proposal.essayId !== essayId) {
    throw new ProposalAcceptanceError("PROPOSAL_NOT_ACCEPTABLE");
  }
  if (
    proposal.status !== "PENDING" ||
    proposal.targetRevision !== expectedRevision ||
    new Date(proposal.expiresAt) <= now ||
    hasBlockingClaims(proposal)
  ) {
    throw new ProposalAcceptanceError("PROPOSAL_NOT_ACCEPTABLE");
  }

  const currentDraft = workspace.essay.draftText;
  let nextDraft: string;
  if (proposal.kind === "REWRITE") {
    if (
      proposal.selection.end > Array.from(currentDraft).length ||
      createDraftTextHash(
        sliceByCodePoints(
          currentDraft,
          proposal.selection.start,
          proposal.selection.end,
        ),
      ) !== proposal.selection.textHash
    ) {
      throw new ProposalAcceptanceError("PROPOSAL_NOT_ACCEPTABLE");
    }
    nextDraft = applyRewriteProposal(currentDraft, proposal);
  } else {
    if (
      proposal.cursorOffset > Array.from(currentDraft).length ||
      createDraftTextHash(currentDraft) !== proposal.contextHash
    ) {
      throw new ProposalAcceptanceError("PROPOSAL_NOT_ACCEPTABLE");
    }
    nextDraft = applyContinuationProposal(currentDraft, proposal);
  }
  const result = await dependencies.acceptance.accept({
    essayId,
    expectedCurrentDraft: currentDraft,
    expectedRevision,
    idempotencyKeyHmac,
    nextDraft,
    now,
    proposalId,
    requestHmac,
    userId,
  });
  if (result.type === "ACCEPTED" || result.type === "REPLAY") {
    return result.value;
  }
  const code =
    result.type === "NOT_FOUND"
      ? "RESOURCE_NOT_FOUND"
      : result.type === "STATE_CONFLICT"
        ? "PROPOSAL_NOT_ACCEPTABLE"
        : result.type;
  throw new ProposalAcceptanceError(code);
}
