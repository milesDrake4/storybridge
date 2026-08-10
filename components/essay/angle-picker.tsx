"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AngleCard } from "@/components/essay/angle-card";
import {
  essayAngleListSchema,
  essayAngleSchema,
  essayAngleSetSchema,
  type EssayAngle,
} from "@/contracts/domain/essay-angle";
import type { EssayAngleId } from "@/contracts/domain/ids";
import {
  schoolDossierSchema,
  type SchoolDossierSource,
} from "@/contracts/domain/school-dossier";
import {
  storyProfileWithFactsSchema,
  type StoryFact,
} from "@/contracts/domain/story-vault";
import {
  apiErrorSchema,
  apiSuccessSchema,
} from "@/contracts/http/v1/envelopes";

type Props = {
  essayId: string;
  initialEssayRevision: number;
  initialSelectedAngleId: string | null;
  onRevisionChange?(revision: number): void;
  onSelectionChange?(angleId: EssayAngleId): void;
};

async function json(response: Response) {
  return response.json().catch(() => null);
}

export function AnglePicker({
  essayId,
  initialEssayRevision,
  initialSelectedAngleId,
  onRevisionChange,
  onSelectionChange,
}: Props) {
  const [angles, setAngles] = useState<EssayAngle[]>([]);
  const [selectedId, setSelectedId] = useState(initialSelectedAngleId);
  const currentRevision = useRef(initialEssayRevision);
  const [facts, setFacts] = useState(new Map<string, StoryFact>());
  const [sources, setSources] = useState(
    new Map<string, SchoolDossierSource>(),
  );
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const generationKey = useRef<string | null>(null);
  const regenerateButton = useRef<HTMLButtonElement>(null);
  const regenerateHeading = useRef<HTMLHeadingElement>(null);
  const angleHeading = useRef<HTMLHeadingElement>(null);

  function cancelRegeneration() {
    setConfirmRegenerate(false);
    window.requestAnimationFrame(() => regenerateButton.current?.focus());
  }

  useEffect(() => {
    if (confirmRegenerate) regenerateHeading.current?.focus();
  }, [confirmRegenerate]);

  const loadEvidence = useCallback(async () => {
    const [researchResponse, profileResponse] = await Promise.all([
      fetch(`/api/v1/essays/${essayId}/research`, { cache: "no-store" }),
      fetch("/api/v1/story-profile", { cache: "no-store" }),
    ]);
    const research = apiSuccessSchema(schoolDossierSchema).safeParse(
      await json(researchResponse),
    );
    const profile = apiSuccessSchema(storyProfileWithFactsSchema).safeParse(
      await json(profileResponse),
    );
    if (research.success) {
      setSources(
        new Map(
          research.data.data.sources.map((source) => [source.id, source]),
        ),
      );
    }
    if (profile.success) {
      setFacts(new Map(profile.data.data.facts.map((fact) => [fact.id, fact])));
    }
  }, [essayId]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/essays/${essayId}/angles`, {
        cache: "no-store",
      });
      const parsed = apiSuccessSchema(essayAngleListSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) throw new Error();
      setAngles(parsed.data.data.angles);
      if (parsed.data.data.angles.length) await loadEvidence();
    } catch {
      setNotice(
        "Strategies could not be loaded. Your saved essay is unchanged.",
      );
    } finally {
      setLoading(false);
    }
  }, [essayId, loadEvidence]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function generate(regenerate: boolean) {
    setWorking(true);
    setNotice(null);
    setFollowUp(null);
    generationKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/essays/${essayId}/angles`, {
        body: JSON.stringify({ regenerate }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": generationKey.current,
        },
        method: "POST",
      });
      const body = await json(response);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(body);
        generationKey.current = null;
        if (parsed.success && parsed.data.error.followUpQuestion) {
          setFollowUp(parsed.data.error.followUpQuestion);
        } else if (
          parsed.success &&
          parsed.data.error.code === "STATE_CONFLICT"
        ) {
          setNotice(
            "These strategies changed or the one regeneration was already used. Reload to see the current set.",
          );
        } else {
          setNotice(
            "Strategies were not changed. Try again when you are ready.",
          );
        }
        return;
      }
      const parsed = apiSuccessSchema(essayAngleSetSchema).safeParse(body);
      if (!parsed.success) throw new Error();
      generationKey.current = null;
      setAngles(parsed.data.data.angles);
      setConfirmRegenerate(false);
      if (regenerate) {
        window.requestAnimationFrame(() => angleHeading.current?.focus());
      }
      await loadEvidence();
    } catch {
      setNotice(
        "Strategies were not changed. Check your connection and retry.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function select(angleId: EssayAngleId) {
    setSelectingId(angleId);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/essays/${essayId}/angles/${angleId}/selection`,
        {
          body: "{}",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        setNotice(
          "That angle could not be selected. Reload before trying again.",
        );
        return;
      }
      setSelectedId(angleId);
      onSelectionChange?.(angleId);
      const nextRevision =
        Math.max(initialEssayRevision, currentRevision.current) + 1;
      currentRevision.current = nextRevision;
      onRevisionChange?.(nextRevision);
    } catch {
      setNotice(
        "Selection could not be saved. Your prior selection is unchanged.",
      );
    } finally {
      setSelectingId(null);
    }
  }

  async function save(angleId: string, title: string, thesis: string) {
    setSavingId(angleId);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/essays/${essayId}/angles/${angleId}`,
        {
          body: JSON.stringify({ thesis, title }),
          headers: {
            "content-type": "application/json",
            "if-match": `"essay:${essayId}:r${Math.max(
              initialEssayRevision,
              currentRevision.current,
            )}"`,
          },
          method: "PATCH",
        },
      );
      const parsed = apiSuccessSchema(essayAngleSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) {
        setNotice(
          response.status === 412
            ? "This essay changed elsewhere. Your local edit is still here; reload before saving it."
            : "The strategy edit was not saved. Your local edit is still here.",
        );
        return false;
      }
      setAngles((current) =>
        current.map((angle) =>
          angle.id === angleId ? parsed.data.data : angle,
        ),
      );
      const nextRevision =
        Math.max(initialEssayRevision, currentRevision.current) + 1;
      currentRevision.current = nextRevision;
      onRevisionChange?.(nextRevision);
      return true;
    } catch {
      setNotice(
        "The strategy edit was not saved. Your local edit is still here.",
      );
      return false;
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="angle-picker" aria-labelledby="angle-picker-heading">
      <header>
        <p className="eyebrow">Evidence-linked strategy</p>
        <h2 id="angle-picker-heading" ref={angleHeading} tabIndex={-1}>
          Choose your angle
        </h2>
      </header>
      {notice ? (
        <p className="research-notice" role="alert">
          {notice}
        </p>
      ) : null}
      {followUp ? (
        <div className="angle-follow-up" role="status">
          <h3>One more story would help</h3>
          <p>{followUp}</p>
          <a className="button button-secondary" href="/story-vault">
            Review your Story Vault
          </a>
        </div>
      ) : null}
      {loading ? (
        <p aria-live="polite">Loading strategies…</p>
      ) : angles.length === 0 ? (
        <div className="research-empty">
          <p>
            Generate three distinct strategies grounded in your verified stories
            and the school evidence above.
          </p>
          <button
            className="button button-primary"
            disabled={working}
            onClick={() => void generate(false)}
            type="button"
          >
            {working ? "Building strategies…" : "Generate three angles"}
          </button>
        </div>
      ) : (
        <>
          <div className="angle-grid">
            {angles.map((angle) => (
              <AngleCard
                angle={angle}
                facts={facts}
                key={angle.id}
                onSelect={() => void select(angle.id)}
                onSave={(title, thesis) => save(angle.id, title, thesis)}
                selected={selectedId === angle.id}
                selecting={selectingId === angle.id}
                saving={savingId === angle.id}
                sources={sources}
              />
            ))}
          </div>
          {!selectedId ? (
            confirmRegenerate ? (
              <div
                className="angle-regenerate-warning"
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !working) cancelRegeneration();
                }}
                role="alertdialog"
                aria-labelledby="regenerate-heading"
              >
                <h3
                  id="regenerate-heading"
                  ref={regenerateHeading}
                  tabIndex={-1}
                >
                  Use your one regeneration?
                </h3>
                <p>This permanently replaces all three current strategies.</p>
                <div className="angle-card-actions">
                  <button
                    className="button button-secondary"
                    disabled={working}
                    onClick={cancelRegeneration}
                    type="button"
                  >
                    Keep these angles
                  </button>
                  <button
                    className="button button-danger"
                    disabled={working}
                    onClick={() => void generate(true)}
                    type="button"
                  >
                    {working ? "Regenerating…" : "Replace all three"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="button button-secondary angle-regenerate-button"
                onClick={() => setConfirmRegenerate(true)}
                ref={regenerateButton}
                type="button"
              >
                Regenerate once
              </button>
            )
          ) : null}
        </>
      )}
    </section>
  );
}
