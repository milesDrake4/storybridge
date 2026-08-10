import type { CheckoutBindingId, UserId } from "@/contracts/domain/ids";
import type { ApplicationSeason } from "@/contracts/http/v1/essays";
import type { ContentHmac, IdempotencyHmac } from "@/lib/security/hmac";

export type CheckoutReservation =
  | {
      bindingId: CheckoutBindingId;
      checkoutUrl: string;
      expiresAt: Date;
      type: "READY";
    }
  | {
      bindingId: CheckoutBindingId;
      expiresAt: Date;
      type: "PENDING";
    }
  | { type: "IDEMPOTENCY_KEY_REUSED" | "STATE_CONFLICT" };

export interface CheckoutSessionRepository {
  reserve(input: {
    amountCents: number;
    bindingId: CheckoutBindingId;
    currency: "usd";
    expiresAt: Date;
    idempotencyKeyHmac: IdempotencyHmac;
    mode: "payment";
    now: Date;
    priceId: string;
    requestHmac: ContentHmac;
    season: ApplicationSeason;
    userBindingHmac: ContentHmac;
    userId: UserId;
  }): Promise<CheckoutReservation>;
  finalize(input: {
    bindingId: CheckoutBindingId;
    checkoutUrl: string;
    customerId: string | null;
    expiresAt: Date;
    now: Date;
    sessionId: string;
  }): Promise<
    { type: "FINALIZED" | "REPLAY" } | { type: "NOT_FOUND" | "STATE_CONFLICT" }
  >;
}
