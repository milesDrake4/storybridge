"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  schoolDossierSchema,
  type SchoolDossier,
} from "@/contracts/domain/school-dossier";
import {
  apiErrorSchema,
  apiSuccessSchema,
} from "@/contracts/http/v1/envelopes";
import { RefreshResearchDialog } from "@/components/essay/refresh-research-dialog";

type Props = {
  essayId: string;
  essayRevision: number;
  initialDossier?: SchoolDossier | null;
  onRevisionChange?(revision: number): void;
};

async function json(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorCopy(code: string | null): string {
  if (code === "REVISION_MISMATCH")
    return "This essay changed elsewhere. Reload the workspace before refreshing; your current research and dependent work were kept.";
  if (code === "AI_BUDGET_EXHAUSTED")
    return "Research is temporarily paused by the service budget. Try again later; your essay is unchanged.";
  if (code === "QUOTA_EXCEEDED")
    return "Your current AI usage limit has been reached. Your essay is unchanged.";
  if (code === "PROVIDER_INVALID_RESPONSE")
    return "The research result lacked reliable citations, so nothing was saved. Try again for a new result.";
  return "Research did not finish, so nothing was saved or changed. Try again when you are ready.";
}

function revisionFromEtag(etag: string | null, essayId: string): number | null {
  const match = new RegExp(
    `^"essay:${essayId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:r([1-9][0-9]*)"$`,
  ).exec(etag ?? "");
  return match ? Number(match[1]) : null;
}

export function ResearchPanel({
  essayId,
  essayRevision,
  initialDossier,
  onRevisionChange,
}: Props) {
  const [dossier, setDossier] = useState(initialDossier ?? null);
  const currentRevision = useRef(essayRevision);
  const [loading, setLoading] = useState(initialDossier === undefined);
  const [researching, setResearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);
  const pendingKey = useRef<string | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const researchHeading = useRef<HTMLHeadingElement>(null);

  function cancelRefresh() {
    setConfirmingRefresh(false);
    window.requestAnimationFrame(() => refreshButton.current?.focus());
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/essays/${essayId}/research`, {
        cache: "no-store",
      });
      if (response.status === 404) {
        setDossier(null);
        return;
      }
      const parsed = apiSuccessSchema(schoolDossierSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) throw new Error();
      setDossier(parsed.data.data);
    } catch {
      setNotice(
        "Saved research could not be loaded. Your essay is unchanged; try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [essayId]);

  useEffect(() => {
    if (initialDossier !== undefined) return;
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [initialDossier, load]);

  async function research(refresh = false) {
    setResearching(true);
    setNotice(null);
    pendingKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/essays/${essayId}/research`, {
        body: JSON.stringify(
          refresh
            ? { invalidateDependentWork: true, refresh: true }
            : { refresh: false },
        ),
        headers: {
          "content-type": "application/json",
          "idempotency-key": pendingKey.current,
          ...(refresh
            ? {
                "if-match": `"essay:${essayId}:r${Math.max(
                  essayRevision,
                  currentRevision.current,
                )}"`,
              }
            : {}),
        },
        method: "POST",
      });
      const body = await json(response);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(body);
        const code = parsed.success ? parsed.data.error.code : null;
        pendingKey.current = null;
        setNotice(errorCopy(code));
        return;
      }
      const parsed = apiSuccessSchema(schoolDossierSchema).safeParse(body);
      if (!parsed.success) throw new Error();
      pendingKey.current = null;
      setDossier(parsed.data.data);
      const nextRevision =
        revisionFromEtag(response.headers.get("etag"), essayId) ??
        Math.max(essayRevision, currentRevision.current) + 1;
      currentRevision.current = nextRevision;
      onRevisionChange?.(nextRevision);
      setConfirmingRefresh(false);
      window.requestAnimationFrame(() => researchHeading.current?.focus());
    } catch {
      setNotice(errorCopy(null));
    } finally {
      setResearching(false);
    }
  }

  if (loading) {
    return (
      <section
        className="research-panel"
        aria-busy="true"
        aria-label="Loading cited school research"
      >
        <p>Loading cited research…</p>
      </section>
    );
  }

  return (
    <section className="research-panel" aria-labelledby="research-heading">
      <header>
        <p className="eyebrow">Verified-domain research</p>
        <h2 id="research-heading" ref={researchHeading} tabIndex={-1}>
          School evidence
        </h2>
      </header>
      {notice ? (
        <p className="research-notice" role="alert">
          {notice}
        </p>
      ) : null}
      {!dossier ? (
        <div className="research-empty">
          <p>
            Research uses only the school’s verified public domain. Your prompt,
            Story Vault, and draft are never sent to web search.
          </p>
          <button
            className="button button-secondary"
            disabled={researching}
            onClick={() => void research()}
            type="button"
          >
            {researching
              ? "Researching…"
              : notice
                ? "Retry school research"
                : "Research this school"}
          </button>
        </div>
      ) : (
        <div>
          <p className="research-summary">{dossier.summary}</p>
          <ol className="research-sources">
            {dossier.sources.map((source) => (
              <li key={source.id}>
                <p className="research-category">
                  {source.category.toLocaleLowerCase("en-US")}
                </p>
                <h3>{source.claim}</h3>
                <blockquote>{source.supportingExcerpt}</blockquote>
                <p className="research-provenance">
                  Retrieved{" "}
                  {new Date(source.retrievedAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                <a
                  href={source.normalizedUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {source.title}{" "}
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ol>
          {confirmingRefresh ? (
            <RefreshResearchDialog
              busy={researching}
              onCancel={cancelRefresh}
              onConfirm={() => void research(true)}
            />
          ) : (
            <button
              className="button button-secondary research-refresh-button"
              disabled={researching}
              ref={refreshButton}
              onClick={() => {
                setNotice(null);
                setConfirmingRefresh(true);
              }}
              type="button"
            >
              Refresh school research
            </button>
          )}
        </div>
      )}
    </section>
  );
}
