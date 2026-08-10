"use client";

import { useRef, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import { checkoutSessionResponseSchema } from "@/contracts/http/v1/billing";

type Props = {
  priceCents: number;
  onCheckoutReady?: (checkoutUrl: string) => void;
};

function formatPrice(priceCents: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(priceCents / 100);
}

export function SeasonPassPanel({ priceCents, onCheckoutReady }: Props) {
  const idempotencyKey = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function startCheckout() {
    if (loading) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/billing/checkout-sessions", {
        body: JSON.stringify({ season: "2026-2027" }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
        },
        method: "POST",
      });
      const body: unknown = await response.json();
      const parsed = apiSuccessSchema(checkoutSessionResponseSchema).safeParse(
        body,
      );
      if (!response.ok || !parsed.success) {
        if (response.status === 409) idempotencyKey.current = null;
        throw new Error("Checkout creation failed");
      }
      const url = parsed.data.data.checkoutUrl;
      if (onCheckoutReady) onCheckoutReady(url);
      else window.location.assign(url);
    } catch {
      setNotice(
        "Secure checkout is temporarily unavailable. No payment was started; try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="season-pass-panel" aria-labelledby="season-pass-heading">
      <div>
        <p className="eyebrow">2026–2027 season pass</p>
        <h2 id="season-pass-heading">More room for your application</h2>
        <p>
          Unlock the paid essay allowance for {formatPrice(priceCents)} with a
          one-time payment through Stripe.
        </p>
        <p className="season-pass-note">
          Access activates only after StoryBridge verifies Stripe’s payment
          confirmation. Returning from checkout alone never grants access.
        </p>
      </div>
      <div>
        <p className="season-pass-price">{formatPrice(priceCents)}</p>
        <button
          className="button button-primary"
          disabled={loading}
          onClick={() => void startCheckout()}
          type="button"
        >
          {loading ? "Opening Stripe…" : "Continue to secure checkout"}
        </button>
        {notice ? <p role="alert">{notice}</p> : null}
      </div>
    </aside>
  );
}
