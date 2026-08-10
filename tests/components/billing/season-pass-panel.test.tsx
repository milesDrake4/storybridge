import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeasonPassPanel } from "@/components/billing/season-pass-panel";

const checkoutUrl = "https://checkout.stripe.com/c/pay/cs_test_safe";

afterEach(() => vi.unstubAllGlobals());

function success() {
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      data: {
        checkoutUrl,
        expiresAt: "2026-08-04T17:00:00.000Z",
      },
      meta: { requestId: "f9000000-0000-4000-8000-000000000001" },
    }),
    { headers: { "content-type": "application/json" }, status: 201 },
  );
}

describe("season pass panel", () => {
  it("shows the configured price and sends only the season", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal("fetch", fetchMock);
    const onCheckoutReady = vi.fn();
    const user = userEvent.setup();
    render(
      <SeasonPassPanel onCheckoutReady={onCheckoutReady} priceCents={2_499} />,
    );

    expect(screen.getByText("$24.99")).toBeVisible();
    expect(
      screen.getByText(/Returning from checkout alone never grants/i),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Continue to secure checkout" }),
    );

    expect(onCheckoutReady).toHaveBeenCalledWith(checkoutUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/billing/checkout-sessions",
      expect.objectContaining({
        body: JSON.stringify({ season: "2026-2027" }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
        method: "POST",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toMatch(
      /amount|currency|mode|price|user/i,
    );
  });

  it("keeps the panel usable when checkout is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const user = userEvent.setup();
    render(<SeasonPassPanel priceCents={2_499} />);

    await user.click(
      screen.getByRole("button", { name: "Continue to secure checkout" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No payment was started",
    );
    expect(
      screen.getByRole("button", { name: "Continue to secure checkout" }),
    ).toBeEnabled();
  });
});
