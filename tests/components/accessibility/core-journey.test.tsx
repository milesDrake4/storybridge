import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";
import { CollapsibleWorkspacePanel } from "@/components/ui/collapsible-workspace-panel";
import { AsyncStatus } from "@/components/ui/async-status";
import { ErrorSummary } from "@/components/ui/error-summary";
import { SkipLink } from "@/components/ui/skip-link";

describe("core journey accessibility primitives", () => {
  it("offers a skip link to the main landmark", () => {
    render(
      <>
        <SkipLink />
        <HomePage />
      </>,
    );

    expect(
      screen.getByRole("link", { name: "Skip to main content" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("announces non-blocking and blocking asynchronous feedback", () => {
    const { rerender } = render(
      <AsyncStatus kind="status">Saving your draft…</AsyncStatus>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");

    rerender(<AsyncStatus kind="error">The draft was not saved.</AsyncStatus>);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("moves focus to a labeled error summary", () => {
    render(
      <ErrorSummary title="Check the form">
        Choose a verified school before continuing.
      </ErrorSummary>,
    );

    const summary = screen.getByRole("alert");
    expect(summary).toHaveFocus();
    expect(summary).toHaveAccessibleName("Check the form");
  });

  it("uses a native keyboard-operable disclosure for editor tools", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleWorkspacePanel title="Coaching tools">
        <button type="button">Request coaching</button>
      </CollapsibleWorkspacePanel>,
    );
    const disclosure = screen.getByText("Coaching tools").closest("details");
    expect(disclosure).toHaveAttribute("open");

    await user.click(screen.getByText("Coaching tools"));
    expect(disclosure).not.toHaveAttribute("open");
  });
});
