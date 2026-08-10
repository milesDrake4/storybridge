"use client";

import { useEffect, useRef, useState } from "react";

import type {
  AccountDeletionStatusResponse,
  DeletionRequest,
} from "@/contracts/http/v1/me";

type ApiEnvelope<T> = { data: T };

function messageFromStatus(status: AccountDeletionStatusResponse["status"]) {
  if (status === "COMPLETE") return "Your account deletion is complete.";
  if (status === "FAILED") {
    return "Deletion could not complete automatically. Your status token remains valid for support follow-up.";
  }
  if (status === "PROCESSING") return "Your account deletion is processing.";
  return "Your account deletion is queued.";
}

export function AccountPrivacyPanel() {
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (deletion) receiptHeading.current?.focus();
  }, [deletion]);

  async function deleteAccount() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/me", {
        body: JSON.stringify({ confirmation }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        method: "DELETE",
      });
      if (!response.ok) throw new Error("DELETE_FAILED");
      const body = (await response.json()) as ApiEnvelope<DeletionRequest>;
      setDeletion(body.data);
      setStatus(
        "Your account deletion is queued and all sessions are signed out.",
      );
    } catch {
      setError(
        "We could not queue deletion. Your account has not been deleted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshStatus() {
    if (!deletion) return;
    setError(null);
    try {
      const response = await fetch("/api/v1/me/deletion", {
        headers: { authorization: `DeletionStatus ${deletion.statusToken}` },
      });
      if (!response.ok) throw new Error("STATUS_FAILED");
      const body =
        (await response.json()) as ApiEnvelope<AccountDeletionStatusResponse>;
      setStatus(messageFromStatus(body.data.status));
    } catch {
      setError(
        "We could not refresh deletion status. Keep your token and try again.",
      );
    }
  }

  return (
    <div className="privacy-controls">
      <section className="privacy-card" aria-labelledby="export-heading">
        <p className="eyebrow">Export</p>
        <h2 id="export-heading">Download your data</h2>
        <p>
          Get a bounded JSON file containing your profile, interview, Story
          Vault, essay, research, coaching, audit, and entitlement records.
          Internal security and payment-linkage fields are excluded.
        </p>
        <a
          className="button button-secondary"
          href="/api/v1/me/export"
          download
        >
          Download my data
        </a>
      </section>

      <section
        className="privacy-card privacy-danger"
        aria-labelledby="delete-heading"
      >
        <p className="eyebrow">Permanent deletion</p>
        <h2 id="delete-heading">Delete your StoryBridge account</h2>
        <p>
          This signs out every session immediately and permanently removes your
          live application content. Type <strong>DELETE</strong> to confirm.
        </p>
        {!deletion ? (
          <>
            <label className="field-label" htmlFor="delete-confirmation">
              Confirmation
            </label>
            <input
              autoComplete="off"
              className="field-input"
              id="delete-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              spellCheck={false}
              value={confirmation}
            />
            <button
              className="button button-danger"
              disabled={confirmation !== "DELETE" || submitting}
              onClick={deleteAccount}
              type="button"
            >
              {submitting ? "Queuing deletion…" : "Permanently delete account"}
            </button>
          </>
        ) : (
          <div className="deletion-receipt" role="status">
            <h3 ref={receiptHeading} tabIndex={-1}>
              Save this one-time status token
            </h3>
            <p>
              It is shown only here. Store it somewhere private if you want to
              check deletion after this page closes.
            </p>
            <code aria-label="Deletion status token">
              {deletion.statusToken}
            </code>
            <button
              className="button button-secondary"
              onClick={refreshStatus}
              type="button"
            >
              Check deletion status
            </button>
          </div>
        )}
        {status ? (
          <p className="form-status" role="status">
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
