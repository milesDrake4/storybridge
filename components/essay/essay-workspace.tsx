"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import {
  essayWorkspaceSchema,
  type EssayWorkspace as EssayWorkspaceValue,
} from "@/contracts/http/v1/essays";

type Props = { essayId: string; initialWorkspace?: EssayWorkspaceValue };

export function EssayWorkspace({ essayId, initialWorkspace }: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace ?? null);
  const [loading, setLoading] = useState(initialWorkspace === undefined);
  const [error, setError] = useState(false);

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
        Your workspace is ready. Verified school research and strategy tools
        arrive in the next guided step.
      </p>
      <Link className="button button-secondary" href="/essays">
        Back to essays
      </Link>
    </article>
  );
}
