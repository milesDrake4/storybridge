"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { EssayAngleId } from "@/contracts/domain/ids";
import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import {
  essayWorkspaceSchema,
  type EssayWorkspace as EssayWorkspaceValue,
} from "@/contracts/http/v1/essays";
import { ResearchPanel } from "@/components/essay/research-panel";
import { AnglePicker } from "@/components/essay/angle-picker";
import { OutlineEditor } from "@/components/essay/outline-editor";
import { PlainTextEditor } from "@/components/essay/plain-text-editor";
import { CoachPanel } from "@/components/essay/coach-panel";

type Props = { essayId: string; initialWorkspace?: EssayWorkspaceValue };

export function EssayWorkspace({ essayId, initialWorkspace }: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace ?? null);
  const [loading, setLoading] = useState(initialWorkspace === undefined);
  const [error, setError] = useState(false);

  const updateRevision = useCallback((revision: number) => {
    setWorkspace((current) =>
      current ? { ...current, essay: { ...current.essay, revision } } : current,
    );
  }, []);

  const updateSelectedAngle = useCallback((selectedAngleId: EssayAngleId) => {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            essay: {
              ...current.essay,
              selectedAngleId,
              status:
                current.essay.status === "STRATEGY"
                  ? "OUTLINING"
                  : current.essay.status,
            },
          }
        : current,
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/v1/essays/${essayId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      const parsed = apiSuccessSchema(essayWorkspaceSchema).safeParse(body);
      if (!response.ok || !parsed.success) throw new Error();
      setWorkspace(parsed.data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [essayId]);

  useEffect(() => {
    if (initialWorkspace !== undefined) return;
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [initialWorkspace, load]);

  if (loading) {
    return (
      <section className="essay-workspace-view" aria-busy="true">
        <h1>Opening your essay…</h1>
      </section>
    );
  }
  if (error || !workspace) {
    return (
      <section className="essay-workspace-view">
        <p className="eyebrow">Essay workspace</p>
        <h1>This essay could not be opened.</h1>
        <p>
          Your work has not been changed. Return to your essays or try loading
          it again.
        </p>
        <div className="essay-workspace-actions">
          <button
            className="button button-secondary"
            onClick={() => void load()}
            type="button"
          >
            Try again
          </button>
          <Link className="button button-secondary" href="/essays">
            Back to essays
          </Link>
        </div>
      </section>
    );
  }

  return (
    <article
      className="essay-workspace-view"
      aria-labelledby="essay-workspace-heading"
    >
      <p className="eyebrow">
        Essay workspace · {workspace.essay.status.toLocaleLowerCase("en-US")}
      </p>
      <h1 id="essay-workspace-heading">{workspace.school.canonicalName}</h1>
      <dl className="essay-workspace-meta">
        <div>
          <dt>Word limit</dt>
          <dd>{workspace.essay.wordLimit}</dd>
        </div>
        <div>
          <dt>Application season</dt>
          <dd>{workspace.essay.season}</dd>
        </div>
      </dl>
      <section
        className="essay-prompt-card"
        aria-labelledby="saved-prompt-heading"
      >
        <h2 id="saved-prompt-heading">Official prompt</h2>
        <p>{workspace.essay.prompt}</p>
      </section>
      <p className="essay-next-step">
        Your workspace is ready. Build a cited school evidence base before
        choosing your strategy.
      </p>
      <ResearchPanel
        essayId={workspace.essay.id}
        essayRevision={workspace.essay.revision}
        onRevisionChange={updateRevision}
      />
      <AnglePicker
        essayId={workspace.essay.id}
        initialEssayRevision={workspace.essay.revision}
        initialSelectedAngleId={workspace.essay.selectedAngleId}
        onRevisionChange={updateRevision}
        onSelectionChange={updateSelectedAngle}
      />
      <OutlineEditor
        essayId={workspace.essay.id}
        essayRevision={workspace.essay.revision}
        initialOutline={workspace.essay.outline ?? null}
        selectedAngleId={workspace.essay.selectedAngleId}
        wordLimit={workspace.essay.wordLimit}
        onEssayChange={(essay) =>
          setWorkspace((current) => (current ? { ...current, essay } : current))
        }
        onRevisionChange={updateRevision}
      />
      {workspace.essay.outline ? (
        <PlainTextEditor
          essayId={workspace.essay.id}
          initialRevision={workspace.essay.revision}
          initialText={workspace.essay.draftText}
          wordLimit={workspace.essay.wordLimit}
          onSaved={(essay) =>
            setWorkspace((current) =>
              current ? { ...current, essay } : current,
            )
          }
        />
      ) : null}
      {workspace.essay.outline ? (
        <CoachPanel essayId={workspace.essay.id} />
      ) : null}
      <Link className="button button-secondary" href="/essays">
        Back to essays
      </Link>
    </article>
  );
}
