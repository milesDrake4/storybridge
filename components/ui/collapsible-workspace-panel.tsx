"use client";

import { useState, type ReactNode } from "react";

export function CollapsibleWorkspacePanel({
  children,
  initiallyOpen = true,
  title,
}: {
  children: ReactNode;
  initiallyOpen?: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <details
      className="workspace-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>{title}</summary>
      <div className="workspace-disclosure-content">{children}</div>
    </details>
  );
}
