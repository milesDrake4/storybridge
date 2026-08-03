"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
};

export function RefreshResearchDialog({ busy, onCancel, onConfirm }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  return (
    <div
      aria-labelledby="refresh-research-heading"
      aria-describedby="refresh-research-description"
      className="research-refresh-warning"
      role="alertdialog"
    >
      <h3 id="refresh-research-heading" ref={heading} tabIndex={-1}>
        Replace this research?
      </h3>
      <p id="refresh-research-description">
        Refreshing replaces the active evidence set. Any strategy angles,
        selected angle, outline, and pending AI suggestions based on the current
        evidence will be removed or expired.
      </p>
      <label>
        <input
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        I understand that dependent strategy work will be invalidated.
      </label>
      <div className="research-refresh-actions">
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Keep current research
        </button>
        <button
          className="button button-danger"
          disabled={!confirmed || busy}
          onClick={onConfirm}
          type="button"
        >
          {busy ? "Refreshing…" : "Refresh and invalidate work"}
        </button>
      </div>
    </div>
  );
}
