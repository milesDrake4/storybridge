import type { ReactNode } from "react";

export function AsyncStatus({
  children,
  kind = "status",
}: {
  children: ReactNode;
  kind?: "error" | "status";
}) {
  return (
    <p
      aria-atomic="true"
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={kind === "error" ? "form-error" : "form-status"}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
