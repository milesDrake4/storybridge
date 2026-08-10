import type { CheckoutBindingId } from "@/contracts/domain/ids";
import type { ApplicationSeason } from "@/contracts/http/v1/essays";

export type CheckoutMetadata = {
  storybridge_binding_id: CheckoutBindingId;
  storybridge_season: ApplicationSeason;
  storybridge_user_binding: string;
};

export class StripeCheckoutError extends Error {
  readonly kind: "INVALID_RESPONSE" | "UNAVAILABLE";

  constructor(kind: "INVALID_RESPONSE" | "UNAVAILABLE") {
    super(kind);
    this.name = "StripeCheckoutError";
    this.kind = kind;
  }
}

export interface StripeCheckoutPort {
  createSession(input: {
    amountCents: number;
    bindingId: CheckoutBindingId;
    cancelUrl: string;
    currency: "usd";
    expiresAt: Date;
    idempotencyKey: string;
    metadata: CheckoutMetadata;
    mode: "payment";
    priceId: string;
    successUrl: string;
  }): Promise<{
    checkoutUrl: string;
    customerId: string | null;
    expiresAt: Date;
    sessionId: string;
  }>;
}
