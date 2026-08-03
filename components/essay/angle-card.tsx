"use client";

import { useState } from "react";

import type { EssayAngle } from "@/contracts/domain/essay-angle";
import type { SchoolDossierSource } from "@/contracts/domain/school-dossier";
import type { StoryFact } from "@/contracts/domain/story-vault";

type Props = {
  angle: EssayAngle;
  facts: Map<string, StoryFact>;
  onSelect(): void;
  onSave(title: string, thesis: string): Promise<boolean>;
  selected: boolean;
  selecting: boolean;
  saving: boolean;
  sources: Map<string, SchoolDossierSource>;
};

export function AngleCard({
  angle,
  facts,
  onSelect,
  onSave,
  selected,
  selecting,
  saving,
  sources,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(angle.title);
  const [thesis, setThesis] = useState(angle.thesis);

  async function finishEditing() {
    if (!editing) {
      setEditing(true);
      return;
    }
    if (await onSave(title.trim(), thesis.trim())) setEditing(false);
  }

  return (
    <article
      className={`angle-card${selected ? " angle-card-selected" : ""}`}
      aria-labelledby={`angle-${angle.id}-title`}
    >
      <p className="research-category">Strategy {angle.position}</p>
      {editing ? (
        <div className="angle-edit-fields">
          <label>
            Working title
            <input
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>
          <label>
            Working thesis
            <textarea
              maxLength={800}
              onChange={(event) => setThesis(event.target.value)}
              rows={4}
              value={thesis}
            />
          </label>
        </div>
      ) : (
        <>
          <h3 id={`angle-${angle.id}-title`}>{title}</h3>
          <p className="angle-thesis">{thesis}</p>
        </>
      )}
      <dl className="angle-assessment">
        <div>
          <dt>Why it fits</dt>
          <dd>{angle.promptFit}</dd>
        </div>
        <div>
          <dt>Watch out for</dt>
          <dd>{angle.risk}</dd>
        </div>
      </dl>
      <div className="angle-evidence">
        <h4>Your verified evidence</h4>
        <ul>
          {angle.storyFactIds.map((id) => (
            <li key={id}>
              {facts.get(id)?.summary ?? "Verified Story Vault fact"}
            </li>
          ))}
        </ul>
        <h4>School evidence</h4>
        <ul>
          {angle.schoolSourceIds.map((id) => {
            const source = sources.get(id);
            return (
              <li key={id}>
                {source ? (
                  <a
                    href={source.normalizedUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {source.claim}{" "}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  "Current cited school source"
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="angle-card-actions">
        <button
          className="button button-secondary"
          disabled={selected || selecting || saving}
          onClick={() => void finishEditing()}
          type="button"
        >
          {saving
            ? "Saving edit…"
            : editing
              ? "Save strategy edit"
              : "Edit this strategy"}
        </button>
        <button
          className="button button-primary"
          disabled={
            editing ||
            selected ||
            selecting ||
            saving ||
            !title.trim() ||
            !thesis.trim()
          }
          onClick={onSelect}
          type="button"
        >
          {selected
            ? "Selected"
            : selecting
              ? "Selecting…"
              : "Select this angle"}
        </button>
      </div>
    </article>
  );
}
