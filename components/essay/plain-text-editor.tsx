"use client";

import { useState } from "react";

import type { Essay } from "@/contracts/http/v1/essays";
import { useAutosave } from "@/components/essay/use-autosave";
import { RevisionProposalPanel } from "@/components/essay/revision-proposal-panel";

type Props = {
  essayId: string;
  initialRevision: number;
  initialText: string;
  wordLimit: number;
  onSaved?(essay: Essay): void;
};

function countWords(value: string): number {
  const normalized = value.trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

const stateLabel = {
  CONFLICT: "Conflict",
  FAILED: "Save failed",
  IDLE: "Not saved",
  SAVED: "Saved",
  SAVING: "Saving",
} as const;

export function PlainTextEditor(props: Props) {
  const [selection, setSelection] = useState({ end: 0, start: 0 });
  const autosave = useAutosave({
    essayId: props.essayId,
    initialRevision: props.initialRevision,
    initialText: props.initialText,
    onSaved: props.onSaved,
  });
  const words = countWords(autosave.text);

  return (
    <section className="plain-text-editor" aria-labelledby="draft-heading">
      <header>
        <div>
          <p className="eyebrow">Your writing</p>
          <h2 id="draft-heading">Draft in your own words</h2>
        </div>
        <p aria-live="polite" className={`save-state ${autosave.state}`}>
          {stateLabel[autosave.state]}
        </p>
      </header>
      {autosave.recovered ? (
        <p className="research-notice" role="status">
          Recovered unsaved text from this browser. It has not replaced the
          saved version yet.
        </p>
      ) : null}
      <label className="draft-field">
        Essay draft
        <textarea
          maxLength={20_000}
          onBlur={autosave.flush}
          onChange={(event) => autosave.setText(event.target.value)}
          onSelect={(event) =>
            setSelection({
              end: event.currentTarget.selectionEnd,
              start: event.currentTarget.selectionStart,
            })
          }
          spellCheck="true"
          value={autosave.text}
        />
      </label>
      <div className="draft-footer">
        <p>
          {words} / {props.wordLimit} words
        </p>
        {autosave.state === "FAILED" ? (
          <button
            className="button button-secondary"
            onClick={autosave.retry}
            type="button"
          >
            Retry save
          </button>
        ) : null}
      </div>
      {autosave.state === "CONFLICT" ? (
        <div className="draft-conflict" role="alert">
          <h3>This draft changed elsewhere</h3>
          <p>
            Your local writing is still in the editor. Choose which version to
            keep; StoryBridge will not overwrite either one automatically.
          </p>
          {autosave.conflict ? (
            <details>
              <summary>Preview the saved version</summary>
              <pre>{autosave.conflict.serverText || "(Empty draft)"}</pre>
            </details>
          ) : (
            <button
              className="button button-secondary"
              onClick={() => void autosave.refreshConflict()}
              type="button"
            >
              Reload saved version details
            </button>
          )}
          <div className="essay-workspace-actions">
            <button
              className="button button-primary"
              disabled={!autosave.conflict}
              onClick={autosave.retryLocalVersion}
              type="button"
            >
              Keep my local version
            </button>
            <button
              className="button button-secondary"
              disabled={!autosave.conflict}
              onClick={autosave.useServerVersion}
              type="button"
            >
              Use saved version
            </button>
          </div>
        </div>
      ) : null}
      <RevisionProposalPanel
        draftText={autosave.text}
        essayId={props.essayId}
        onAccepted={autosave.adoptServerEssay}
        revision={autosave.currentRevision}
        saved={autosave.state === "SAVED"}
        selection={selection}
      />
    </section>
  );
}
