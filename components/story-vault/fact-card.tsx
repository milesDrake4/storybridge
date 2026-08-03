"use client";

import { useState } from "react";

import type { StoryFactWithSources } from "@/contracts/domain/story-vault";

type Props = {
  busy: boolean;
  fact: StoryFactWithSources;
  onDelete(): Promise<void>;
  onEdit(summary: string, details: string[]): Promise<boolean>;
  onSuppress(suppressed: boolean): Promise<void>;
  onVerify(decision: "VERIFY" | "REJECT"): Promise<void>;
};

export function FactCard({
  busy,
  fact,
  onDelete,
  onEdit,
  onSuppress,
  onVerify,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [summary, setSummary] = useState(fact.summary);
  const [details, setDetails] = useState(fact.details.join("\n"));

  return (
    <article className="fact-card" aria-labelledby={`fact-${fact.id}`}>
      <header className="fact-card-header">
        <p className="eyebrow">{fact.category.toLowerCase()}</p>
        <span
          className={`fact-status status-${fact.verificationStatus.toLowerCase()}`}
        >
          {fact.verificationStatus.toLowerCase()}
        </span>
      </header>

      {editing ? (
        <form
          className="fact-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onEdit(
              summary.trim(),
              details
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            ).then((saved) => {
              if (saved) setEditing(false);
            });
          }}
        >
          <label className="field-label" htmlFor={`summary-${fact.id}`}>
            Summary
          </label>
          <input
            className="field-input"
            disabled={busy}
            id={`summary-${fact.id}`}
            maxLength={500}
            onChange={(event) => setSummary(event.target.value)}
            value={summary}
          />
          <label className="field-label" htmlFor={`details-${fact.id}`}>
            Details, one per line
          </label>
          <textarea
            disabled={busy}
            id={`details-${fact.id}`}
            maxLength={5000}
            onChange={(event) => setDetails(event.target.value)}
            rows={5}
            value={details}
          />
          <div className="fact-actions">
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              Save changes
            </button>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <h2 id={`fact-${fact.id}`}>{fact.summary}</h2>
          <ul className="fact-details">
            {fact.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </>
      )}

      <details className="fact-sources">
        <summary>
          View {fact.sources.length} interview{" "}
          {fact.sources.length === 1 ? "source" : "sources"}
        </summary>
        {fact.sources.map((source) => (
          <blockquote key={source.id}>{source.content}</blockquote>
        ))}
      </details>

      {!editing ? (
        <div
          className="fact-actions"
          aria-label={`Actions for ${fact.summary}`}
        >
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => setEditing(true)}
            type="button"
          >
            Edit
          </button>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void onVerify("VERIFY")}
            type="button"
          >
            Verify
          </button>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void onVerify("REJECT")}
            type="button"
          >
            Reject
          </button>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void onSuppress(fact.suppressedAt === null)}
            type="button"
          >
            {fact.suppressedAt === null ? "Hide from AI" : "Restore to AI"}
          </button>
          <button
            className="button button-secondary danger-button"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            type="button"
          >
            Delete
          </button>
        </div>
      ) : null}

      {confirmingDelete ? (
        <div className="delete-confirmation" role="alert">
          <p>Delete this fact and its source links? This cannot be undone.</p>
          <div className="fact-actions">
            <button
              className="button danger-button"
              disabled={busy}
              onClick={() => void onDelete()}
              type="button"
            >
              Delete permanently
            </button>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              Keep fact
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
