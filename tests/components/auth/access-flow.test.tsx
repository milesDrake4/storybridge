import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { AccessForm } from "@/components/auth/access-form";
import { ConsentForm } from "@/components/auth/consent-form";
import { productAccessRedirect } from "@/services/auth/access-navigation";
import { CURRENT_POLICY_VERSIONS } from "@/services/auth/eligibility";
import { EligibilityError } from "@/services/auth/eligibility";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invited access flow", () => {
  it("routes signed-out and stale-consent product access without loops", () => {
    expect(productAccessRedirect(new EligibilityError("AUTH_REQUIRED"))).toBe(
      "/sign-in",
    );
    expect(productAccessRedirect(new EligibilityError("SESSION_EXPIRED"))).toBe(
      "/sign-in",
    );
    expect(
      productAccessRedirect(new EligibilityError("CONSENT_REQUIRED")),
    ).toBe("/consent");
  });

  it("requests a magic link and gives the same completion message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { accepted: true },
          meta: { requestId: "request-id" },
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AccessForm inviteToken="invite-token" />);
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "Student@Example.com",
    );
    await user.click(screen.getByRole("button", { name: "Email me a link" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/magic-links",
      expect.objectContaining({
        body: JSON.stringify({
          email: "Student@Example.com",
          inviteToken: "invite-token",
        }),
        method: "POST",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "If your invitation is valid, your sign-in link is on its way.",
    );
  });

  it("shows fixed recovery copy and never renders provider details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "Supabase: email provider rejected student@example.com",
          },
        }),
        { status: 500 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AccessForm initialError="AUTH_CALLBACK_FAILED" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That sign-in link could not be used. Request a new one below.",
    );

    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "student@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Email me a link" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not send a link right now. Please try again.",
    );
    expect(screen.queryByText(/Supabase/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/student@example.com/i)).not.toBeInTheDocument();
  });

  it("records adult consent with the current policy versions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { userId: crypto.randomUUID() } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onComplete = vi.fn();
    const user = userEvent.setup();

    render(<ConsentForm currentYear={2026} onComplete={onComplete} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Birth year" }),
      "2000",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm that I am at least 18 years old/i,
      }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /I agree to the Terms/i }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I acknowledge the Privacy Notice/i,
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I agree to use StoryBridge responsibly/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Enter StoryBridge" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/me/consent",
      expect.objectContaining({
        body: JSON.stringify({
          ageConfirmed: true,
          birthYear: 2000,
          ...CURRENT_POLICY_VERSIONS,
        }),
        method: "PUT",
      }),
    );
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("gives under-18 users a clear fixed explanation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "BETA_AGE_RESTRICTED",
            message: "private provider detail",
          },
        }),
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ConsentForm currentYear={2026} onComplete={vi.fn()} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Birth year" }),
      "2010",
    );
    for (const checkbox of screen.getAllByRole("checkbox")) {
      await user.click(checkbox);
    }
    await user.click(screen.getByRole("button", { name: "Enter StoryBridge" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The closed beta is currently limited to people age 18 or older.",
    );
    expect(
      screen.queryByText(/private provider detail/i),
    ).not.toBeInTheDocument();
  });
});
