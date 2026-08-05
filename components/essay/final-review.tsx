"use client";

import { useRef, useState } from "react";

import {
  type AuditIssueCode,
  essayAuditSchema,
  type EssayAudit,
} from "@/contracts/http/v1/audits";
import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";

type RecoveryAction = { href: string; label: string };

const recoveryByIssue: Record<AuditIssueCode, RecoveryAction> = {
  EMPTY_DRAFT: { href: "#draft-heading", label: "Return to your draft" },
  WORD_LIMIT_EXCEEDED: {
    href: "#draft-heading",
    label: "Shorten your draft",
  },
  PROMPT_COVERAGE_WEAK: {
    href: "#saved-prompt-heading",
    label: "Compare your draft with the prompt",
  },
  EVIDENCE_MISSING: {
    href: "#research-heading",
    label: "Review your evidence",
  },
  SCHOOL_CITATION_MISSING: {
    href: "#research-heading",
    label: "Review school sources",
  },
  VOICE_PROFILE_MISSING: {
    href: "/story-vault",
    label: "Review your Story Vault voice profile",
  },
  REPEATED_LANGUAGE: {
    href: "#draft-heading",
    label: "Revise repeated language",
  },
  UNSUPPORTED_CLAIM: {
    href: "#draft-heading",
    label: "Remove or support the claim",
  },
  REFERENCE_CLAIM_UNDECIDED: {
    href: "#reference-draft-heading",
    label: "Review reference claims",
  },
  REJECTED_CLAIM_PRESENT: {
    href: "#draft-heading",
    label: "Remove the rejected claim",
  },
  REFERENCE_SIMILARITY: {
    href: "#draft-heading",
    label: "Rewrite in your own structure and language",
  },
};

type Props = { essayId: string; essayRevision: number };

export function FinalReview({ essayId, essayRevision }: Props) {
  const [audit, setAudit] = useState<EssayAudit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<"review" | "copy" | "download" | null>(
    null,
  );
  const auditKey = useRef<string | null>(null);

  async function review() {
    setWorking("review");
    setNotice(null);
    auditKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/essays/${essayId}/audits`, {
        body: "{}",
        headers: {
          "content-type": "application/json",
          "idempotency-key": auditKey.current,
        },
        method: "POST",
      });
      const parsed = apiSuccessSchema(essayAuditSchema).safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !parsed.success) throw new Error();
      auditKey.current = null;
      setAudit(parsed.data.data);
    } catch {
      setNotice(
        "Final review could not finish. Your draft is unchanged; try again.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function getApprovedText(): Promise<string> {
    const response = await fetch(`/api/v1/essays/${essayId}/export.txt`, {
      cache: "no-store",
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("text/plain")
    ) {
      throw new Error();
    }
    return response.text();
  }

  async function copyDraft() {
    setWorking("copy");
    setNotice(null);
    try {
      await navigator.clipboard.writeText(await getApprovedText());
      setNotice("Student draft copied.");
    } catch {
      setNotice(
        "Export is no longer available. Run final review again after resolving any changes.",
      );
      setAudit(null);
    } finally {
      setWorking(null);
    }
  }

  async function downloadDraft() {
    setWorking("download");
    setNotice(null);
    try {
      const url = URL.createObjectURL(
        new Blob([await getApprovedText()], {
          type: "text/plain;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.download = "storybridge-essay.txt";
      link.href = url;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("Student draft downloaded.");
    } catch {
      setNotice(
        "Export is no longer available. Run final review again after resolving any changes.",
      );
      setAudit(null);
    } finally {
      setWorking(null);
    }
  }

  const currentAudit = audit?.essayRevision === essayRevision ? audit : null;
  const ready = currentAudit?.status === "PASS";
  const visibleNotice =
    audit && !currentAudit
      ? "Your draft changed. Run final review again before export."
      : notice;

  return (
    <section className="final-review" aria-labelledby="final-review-heading">
      <p className="eyebrow">Integrity check</p>
      <h2 id="final-review-heading">Final review and export</h2>
      <p>
        Review the current saved revision before copying or downloading your
        student-authored draft.
      </p>
      <button
        className="button button-primary"
        disabled={working !== null}
        onClick={() => void review()}
        type="button"
      >
        {working === "review" ? "Reviewing…" : "Run final review"}
      </button>

      {currentAudit ? (
        <div className={`final-review-result ${currentAudit.status}`}>
          <p role="status">
            {ready
              ? "Ready to export — this saved revision passed all blocking checks."
              : "Export is blocked — resolve the items below and run final review again."}
          </p>
          {currentAudit.issues.length ? (
            <ul className="final-review-issues">
              {currentAudit.issues.map((issue, index) => {
                const recovery = recoveryByIssue[issue.code];
                return (
                  <li key={`${issue.code}:${index}`}>
                    <p>
                      <strong>
                        {issue.severity.toLocaleLowerCase("en-US")}
                      </strong>
                      {" — "}
                      {issue.message}
                    </p>
                    <a href={recovery.href}>{recovery.label}</a>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {ready ? (
            <div className="essay-workspace-actions">
              <button
                className="button button-secondary"
                disabled={working !== null}
                onClick={() => void copyDraft()}
                type="button"
              >
                {working === "copy" ? "Copying…" : "Copy student draft"}
              </button>
              <button
                className="button button-secondary"
                disabled={working !== null}
                onClick={() => void downloadDraft()}
                type="button"
              >
                {working === "download" ? "Downloading…" : "Download .txt"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {visibleNotice ? <p role="alert">{visibleNotice}</p> : null}
      <p className="final-review-policy">
        Before submitting, follow your institution&apos;s AI policy and confirm
        that the essay accurately represents your own experience, judgment, and
        writing.
      </p>
    </section>
  );
}
