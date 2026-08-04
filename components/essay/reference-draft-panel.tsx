"use client";

import { useRef, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import {
  claimConfirmationSchema,
  CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
  referenceDraftProposalSchema,
  type ClaimDecisionInput,
  type ReferenceDraftProposal,
} from "@/contracts/http/v1/reference-drafts";

type Props = {
  essayId: string;
  initialProposal?: ReferenceDraftProposal | null;
};

export function ReferenceDraftPanel({
  essayId,
  initialProposal = null,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [proposal, setProposal] = useState(initialProposal);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generationKey = useRef<string | null>(null);
  const decisionKeys = useRef(new Map<string, string>());

  async function generate() {
    setWorking("generation");
    setNotice(null);
    generationKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/v1/essays/${essayId}/reference-draft`,
        {
          body: JSON.stringify({
            acknowledgmentVersion: CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
          }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": generationKey.current,
          },
          method: "POST",
        },
      );
      const parsed = apiSuccessSchema(referenceDraftProposalSchema).safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !parsed.success) throw new Error();
      generationKey.current = null;
      setProposal(parsed.data.data);
    } catch {
      setNotice(
        "The reference draft could not be generated. Your student draft is unchanged.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function decide(
    claimId: string,
    decision: ClaimDecisionInput["decision"],
  ) {
    const requestKey = `${claimId}:${decision}`;
    setWorking(claimId);
    setNotice(null);
    if (!decisionKeys.current.has(requestKey)) {
      decisionKeys.current.set(requestKey, crypto.randomUUID());
    }
    try {
      const response = await fetch(
        `/api/v1/essays/${essayId}/reference-claim-confirmations/${claimId}`,
        {
          body: JSON.stringify({ decision }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": decisionKeys.current.get(requestKey)!,
          },
          method: "PUT",
        },
      );
      const parsed = apiSuccessSchema(claimConfirmationSchema).safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !parsed.success) throw new Error();
      decisionKeys.current.delete(requestKey);
      setProposal((current) =>
        current
          ? {
              ...current,
              claims: current.claims.map((claim) =>
                claim.id === parsed.data.data.claimId
                  ? {
                      ...claim,
                      decidedAt: parsed.data.data.decidedAt,
                      decision: parsed.data.data.decision,
                    }
                  : claim,
              ),
            }
          : current,
      );
    } catch {
      setNotice(
        "That claim decision could not be verified. Retry the same choice or reload to check its status.",
      );
    } finally {
      setWorking(null);
    }
  }

  return (
    <section
      className="reference-draft-panel"
      aria-labelledby="reference-draft-heading"
    >
      <p className="eyebrow">Optional fallback</p>
      <h2 id="reference-draft-heading">AI reference draft — read only</h2>
      <p>
        Use this only when you are stuck. It is a reference requiring
        substantial revision, not student-authored text, and cannot be inserted
        or exported by StoryBridge.
      </p>
      {!proposal ? (
        <>
          <label className="reference-acknowledgment">
            <input
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              type="checkbox"
            />
            I understand this is an AI reference draft that I must substantially
            revise in my own words.
          </label>
          <button
            className="button button-secondary"
            disabled={!acknowledged || working !== null}
            onClick={() => void generate()}
            type="button"
          >
            {working === "generation"
              ? "Generating reference…"
              : "Generate my one reference draft"}
          </button>
        </>
      ) : (
        <>
          <pre aria-label="AI reference draft" className="reference-draft-text">
            {proposal.referenceText}
          </pre>
          <h3>Review every factual claim</h3>
          <p>
            Confirm only claims you know are accurate. Rejected claims remain
            integrity blockers until they are absent from your student draft.
          </p>
          <ol className="reference-claim-list">
            {proposal.claims.map((claim) => (
              <li key={claim.id}>
                <blockquote>{claim.text}</blockquote>
                <div className="reference-evidence-grid">
                  {claim.evidence.storyFacts.map((fact) => (
                    <p key={fact.id}>
                      <strong>Verified Story Vault fact:</strong> {fact.summary}
                    </p>
                  ))}
                  {claim.evidence.schoolSources.map((source) => (
                    <p key={source.id}>
                      <strong>Cited school source — {source.title}:</strong>{" "}
                      {source.claim}
                    </p>
                  ))}
                </div>
                {claim.decision ? (
                  <p
                    className={`claim-decision ${claim.decision}`}
                    role="status"
                  >
                    {claim.decision === "CONFIRMED"
                      ? "Confirmed as accurate"
                      : "Rejected — remove this claim from your student draft"}
                  </p>
                ) : (
                  <div className="essay-workspace-actions">
                    <button
                      className="button button-primary"
                      disabled={working !== null}
                      onClick={() => void decide(claim.id, "CONFIRM")}
                      type="button"
                    >
                      Confirm claim
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={working !== null}
                      onClick={() => void decide(claim.id, "REJECT")}
                      type="button"
                    >
                      Reject claim
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="research-notice">
            Follow the target institution’s AI policy before submitting any
            application.
          </p>
        </>
      )}
      {notice ? <p role="alert">{notice}</p> : null}
    </section>
  );
}
