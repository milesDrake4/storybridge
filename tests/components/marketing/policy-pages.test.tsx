import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AccountDeletionPage from "@/app/account-deletion/page";
import HomePage from "@/app/page";
import PricingPage from "@/app/pricing/page";
import PrivacyPage from "@/app/privacy/page";
import ResponsibleUsePage from "@/app/responsible-use/page";
import SupportPage from "@/app/support/page";
import TermsPage from "@/app/terms/page";

describe("public marketing and policy pages", () => {
  it("describes coaching without promising an admission outcome", () => {
    const { container } = render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /discover what only you can say/i }),
    ).toBeVisible();
    expect(screen.getByText(/invitation-only closed beta/i)).toBeVisible();
    expect(screen.getByText(/18 or older/i)).toBeVisible();
    expect(container).not.toHaveTextContent(
      /guaranteed admission|acceptance odds/i,
    );
    expect(container).not.toHaveTextContent(/testimonial/i);
  });

  it("states the implemented free and paid limits", () => {
    render(<PricingPage />);

    expect(screen.getByText("$24.99")).toBeVisible();
    expect(screen.getByText(/one essay workspace/i)).toBeVisible();
    expect(screen.getByText(/up to 20 essay workspaces/i)).toBeVisible();
    expect(screen.getByText(/one-time payment/i)).toBeVisible();
    expect(screen.getByText(/does not guarantee admission/i)).toBeVisible();
  });

  it("names processors and discloses implemented retention", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/Vercel/i)).toBeVisible();
    expect(screen.getByText(/Supabase/i)).toBeVisible();
    expect(screen.getByText(/OpenAI/i)).toBeVisible();
    expect(screen.getAllByText(/Stripe/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/24 hours/i)).toBeVisible();
    expect(
      screen.getByText(/fingerprints expire after 30 days/i),
    ).toBeVisible();
    expect(screen.getByText(/90 days/i)).toBeVisible();
    expect(screen.getByText(/18 months/i)).toBeVisible();
    expect(screen.getByText(/do not sell/i)).toBeVisible();
  });

  it("explains reference-draft and authorship limits", () => {
    render(<ResponsibleUsePage />);

    expect(screen.getByText(/one read-only reference draft/i)).toBeVisible();
    expect(screen.getByText(/cannot be accepted or exported/i)).toBeVisible();
    expect(screen.getByText(/follow each school/i)).toBeVisible();
  });

  it("provides working support and deletion paths", () => {
    const support = render(<SupportPage />);
    expect(screen.getByText(/reply to your invitation email/i)).toBeVisible();
    expect(screen.getByText(/request ID/i)).toBeVisible();
    support.unmount();

    render(<AccountDeletionPage />);
    expect(screen.getByText(/immediately signs you out/i)).toBeVisible();
    expect(screen.getByText(/30 days/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /open privacy settings/i }),
    ).toHaveAttribute("href", "/settings");
  });

  it("states beta eligibility and service boundaries in the terms", () => {
    render(<TermsPage />);

    expect(screen.getByText(/invited adults who attest/i)).toBeVisible();
    expect(
      screen.getByText(/not legal, admissions, or financial advice/i),
    ).toBeVisible();
    expect(screen.getByText(/no promise of admission/i)).toBeVisible();
  });
});
