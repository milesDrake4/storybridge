import type { CheckoutBindingId } from "@/contracts/domain/ids";
import type { ApplicationSeason } from "@/contracts/http/v1/essays";
import type { ContentHmac } from "@/lib/security/hmac";

export type StripeEventCommit = {
  action: "COMPLETE" | "EXPIRE" | "REFUND" | "REJECT" | "RETRY" | "REVOKE";
  alertOperator: boolean;
  amountCents: number | null;
  bindingId: CheckoutBindingId | null;
  chargeId: string | null;
  currency: string | null;
  customerId: string | null;
  eventCreatedAt: Date;
  eventId: string;
  eventType: string;
  livemode: boolean;
  mode: "payment" | null;
  now: Date;
  payloadHmac: ContentHmac;
  paymentIntentId: string | null;
  priceId: string | null;
  safeFailureCode: string | null;
  season: ApplicationSeason | null;
  sessionId: string | null;
  userBindingHmac: string | null;
};

export interface StripeEventRepository {
  commit(input: StripeEventCommit): Promise<{
    type: "PROCESSED" | "REJECTED" | "REPLAY" | "RETRY_PENDING";
  }>;
}
