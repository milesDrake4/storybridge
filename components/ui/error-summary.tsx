"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function ErrorSummary({
  children,
  title = "Something needs your attention",
}: {
  children: ReactNode;
  title?: string;
}) {
  const headingId = useId();
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    summary.current?.focus();
  }, [children]);

  return (
    <div
      aria-labelledby={headingId}
      className="error-summary"
      ref={summary}
      role="alert"
      tabIndex={-1}
    >
      <h2 id={headingId}>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
