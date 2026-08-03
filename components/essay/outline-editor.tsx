"use client";

import { useRef, useState } from "react";

import type { OutlineSectionId } from "@/contracts/domain/ids";
import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import { essaySchema, type Essay } from "@/contracts/http/v1/essays";
import {
  outlineProposalSchema,
  type OutlineProposal,
  type OutlineV1,
} from "@/contracts/http/v1/outlines";

type Props = {
  essayId: string;
  essayRevision: number;
  initialOutline: OutlineV1 | null;
  selectedAngleId: string | null;
  wordLimit: number;
  onEssayChange?(essay: Essay): void;
  onRevisionChange?(revision: number): void;
};

async function json(response: Response) {
  return response.json().catch(() => null);
}

function copyOutline(outline: OutlineV1): OutlineV1 {
  return {
    schemaVersion: "1",
    sections: outline.sections.map((section) => ({
      ...section,
      schoolSourceIds: [...section.schoolSourceIds],
      storyFactIds: [...section.storyFactIds],
    })),
  };
}

export function OutlineEditor({
  essayId,
  essayRevision,
  initialOutline,
  onEssayChange,
  selectedAngleId,
  wordLimit,
  onRevisionChange,
}: Props) {
  const [proposal, setProposal] = useState<OutlineProposal | null>(null);
  const [draft, setDraft] = useState<OutlineV1 | null>(
    initialOutline ? copyOutline(initialOutline) : null,
  );
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const currentRevision = useRef(essayRevision);
  const proposalKey = useRef<string | null>(null);

  async function propose() {
    setWorking(true);
    setNotice(null);
    proposalKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/v1/essays/${essayId}/outline-proposals`,
        {
          body: "{}",
          headers: {
            "content-type": "application/json",
            "idempotency-key": proposalKey.current,
          },
          method: "POST",
        },
      );
      const parsed = apiSuccessSchema(outlineProposalSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) {
        setNotice(
          "An outline proposal could not be generated. Your saved outline is unchanged.",
        );
        return;
      }
      proposalKey.current = null;
      setProposal(parsed.data.data);
    } catch {
      setNotice(
        "An outline proposal could not be generated. Your saved outline is unchanged.",
      );
    } finally {
      setWorking(false);
    }
  }

  function updateSection(
    index: number,
    field: "purpose" | "targetWords",
    value: string,
  ) {
    setDraft((current) => {
      if (!current) return current;
      const sections = current.sections.map((section, position) =>
        position === index
          ? {
              ...section,
              [field]: field === "targetWords" ? Number(value) : value,
            }
          : section,
      );
      return { ...current, sections };
    });
  }

  function move(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const next = index + direction;
      if (next < 0 || next >= current.sections.length) return current;
      const sections = [...current.sections];
      [sections[index], sections[next]] = [sections[next], sections[index]];
      return { ...current, sections };
    });
  }

  function addSection() {
    setDraft((current) => {
      if (!current || current.sections.length >= 6) return current;
      const evidenceTemplate = current.sections[current.sections.length - 1];
      return {
        ...current,
        sections: [
          ...current.sections,
          {
            ...evidenceTemplate,
            id: crypto.randomUUID() as OutlineSectionId,
            purpose: "New section",
          },
        ],
      };
    });
  }

  function removeSection(index: number) {
    setDraft((current) => {
      if (!current || current.sections.length <= 3) return current;
      return {
        ...current,
        sections: current.sections.filter((_, position) => position !== index),
      };
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      const revision = Math.max(essayRevision, currentRevision.current);
      const response = await fetch(`/api/v1/essays/${essayId}`, {
        body: JSON.stringify({ outline: draft }),
        headers: {
          "content-type": "application/json",
          "if-match": `"essay:${essayId}:r${revision}"`,
        },
        method: "PATCH",
      });
      const parsed = apiSuccessSchema(essaySchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) {
        setNotice(
          response.status === 412
            ? "This essay changed elsewhere. Your local outline is still here; reload the workspace before saving it."
            : "The outline was not saved. Check its evidence and word allocation; your local edits are still here.",
        );
        return;
      }
      currentRevision.current = parsed.data.data.revision;
      onEssayChange?.(parsed.data.data);
      onRevisionChange?.(parsed.data.data.revision);
      setDraft(
        parsed.data.data.outline
          ? copyOutline(parsed.data.data.outline)
          : draft,
      );
      setNotice("Outline saved. Drafting is now unlocked.");
    } catch {
      setNotice(
        "The outline was not saved. Your local edits are still here; check your connection and retry.",
      );
    } finally {
      setSaving(false);
    }
  }

  const allocated =
    draft?.sections.reduce(
      (total, section) => total + section.targetWords,
      0,
    ) ?? 0;

  return (
    <section className="outline-editor" aria-labelledby="outline-heading">
      <header>
        <p className="eyebrow">Essay structure</p>
        <h2 id="outline-heading">Build your outline</h2>
      </header>
      {notice ? (
        <p className="research-notice" role="status">
          {notice}
        </p>
      ) : null}
      {!selectedAngleId ? (
        <p>Select an evidence-linked angle before creating an outline.</p>
      ) : (
        <button
          className="button button-secondary"
          disabled={working}
          onClick={() => void propose()}
          type="button"
        >
          {working ? "Creating proposal…" : "Propose an outline"}
        </button>
      )}

      {proposal ? (
        <article
          className="outline-proposal"
          aria-labelledby="proposal-heading"
        >
          <p className="eyebrow">Read-only proposal</p>
          <h3 id="proposal-heading">Suggested structure</h3>
          <p>{proposal.rationale}</p>
          <ol>
            {proposal.outline.sections.map((section) => (
              <li key={section.id}>
                <strong>{section.purpose}</strong> · {section.targetWords} words
              </li>
            ))}
          </ol>
          <p>
            This proposal will not change your outline until you explicitly copy
            it.
          </p>
          <button
            className="button button-primary"
            onClick={() => {
              setDraft(copyOutline(proposal.outline));
              setNotice("Proposal copied into your editable outline.");
            }}
            type="button"
          >
            Start from this outline
          </button>
        </article>
      ) : null}

      {draft ? (
        <div className="outline-draft">
          <h3>Your editable outline</h3>
          {draft.sections.map((section, index) => (
            <fieldset key={section.id}>
              <legend>Section {index + 1}</legend>
              <label>
                Purpose
                <textarea
                  maxLength={300}
                  onChange={(event) =>
                    updateSection(index, "purpose", event.target.value)
                  }
                  value={section.purpose}
                />
              </label>
              <label>
                Target words
                <input
                  min="1"
                  max="1000"
                  onChange={(event) =>
                    updateSection(index, "targetWords", event.target.value)
                  }
                  type="number"
                  value={section.targetWords}
                />
              </label>
              <p>
                Evidence: {section.storyFactIds.length} story fact(s),{" "}
                {section.schoolSourceIds.length} school source(s)
              </p>
              <div className="outline-section-actions">
                <button
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  type="button"
                >
                  Move up
                </button>
                <button
                  disabled={index === draft.sections.length - 1}
                  onClick={() => move(index, 1)}
                  type="button"
                >
                  Move down
                </button>
                <button
                  disabled={draft.sections.length <= 3}
                  onClick={() => removeSection(index)}
                  type="button"
                >
                  Remove section {index + 1}
                </button>
              </div>
            </fieldset>
          ))}
          <button
            className="button button-secondary"
            disabled={draft.sections.length >= 6}
            onClick={addSection}
            type="button"
          >
            Add section
          </button>
          <p>
            Allocated: {allocated} of {wordLimit} words (must be 90%–110%).
          </p>
          <button
            className="button button-primary"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "Saving outline…" : "Save outline"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
