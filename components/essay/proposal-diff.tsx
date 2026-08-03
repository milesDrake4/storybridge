import type {
  ContinuationProposal,
  RewriteProposal,
} from "@/contracts/http/v1/proposals";
import {
  continuationText,
  sliceByCodePoints,
} from "@/lib/essay/apply-proposal";

type Proposal = RewriteProposal | ContinuationProposal;

function claims(proposal: Proposal) {
  return proposal.kind === "REWRITE"
    ? proposal.claims
    : proposal.suggestions.flatMap((suggestion) => suggestion.claims);
}

export function ProposalDiff({
  acceptDisabled = false,
  draftText,
  onAccept,
  onDismiss,
  proposal,
  working = false,
}: {
  acceptDisabled?: boolean;
  draftText: string;
  onAccept(): void;
  onDismiss(): void;
  proposal: Proposal;
  working?: boolean;
}) {
  const blocking = claims(proposal).some(
    (claim) => claim.status === "BLOCKING_UNSUPPORTED",
  );
  const original =
    proposal.kind === "REWRITE"
      ? sliceByCodePoints(
          draftText,
          proposal.selection.start,
          proposal.selection.end,
        )
      : proposal.cursorOffset === Array.from(draftText).length
        ? "End of draft"
        : `Cursor before “${sliceByCodePoints(draftText, proposal.cursorOffset, proposal.cursorOffset + 60)}”`;
  const replacement =
    proposal.kind === "REWRITE"
      ? proposal.proposedText
      : continuationText(proposal);

  return (
    <article className="proposal-diff" aria-labelledby="proposal-heading">
      <p className="eyebrow">Preview only</p>
      <h3 id="proposal-heading">
        {proposal.kind === "REWRITE"
          ? "Proposed rewrite"
          : "Proposed continuation"}
      </h3>
      <div className="proposal-diff-grid">
        <section aria-labelledby="proposal-original-heading">
          <h4 id="proposal-original-heading">Current text</h4>
          <pre>{original}</pre>
        </section>
        <section aria-labelledby="proposal-new-heading">
          <h4 id="proposal-new-heading">Proposed text</h4>
          <pre>{replacement}</pre>
        </section>
      </div>
      {blocking ? (
        <p className="research-notice" role="alert">
          This proposal contains an unsupported factual claim and cannot be
          accepted.
        </p>
      ) : null}
      <div className="essay-workspace-actions">
        <button
          className="button button-primary"
          disabled={acceptDisabled || blocking || working}
          onClick={onAccept}
          type="button"
        >
          {working ? "Applying…" : "Accept this change"}
        </button>
        <button
          className="button button-secondary"
          disabled={working}
          onClick={onDismiss}
          type="button"
        >
          Keep my current draft
        </button>
      </div>
    </article>
  );
}
