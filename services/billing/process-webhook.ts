import type { CheckoutBindingId } from "@/contracts/domain/ids";
import type { ApplicationSeason } from "@/contracts/http/v1/essays";
import type { HmacSecrets } from "@/lib/config/server";
import { createContentHmac } from "@/lib/security/hmac";
import type { StripeEventRepository } from "@/repositories/stripe-event-repository";
import type {
  StripeWebhookAdapter,
  StripeWebhookCandidate,
} from "@/adapters/stripe/webhook";

export type VerifiedStripeLifecycle = {
  amountCents: number;
  bindingId: CheckoutBindingId;
  chargeId: string | null;
  currency: "usd";
  customerId: string | null;
  eventCreatedAt: Date;
  eventId: string;
  eventType:
    | "charge.dispute.created"
    | "charge.refunded"
    | "checkout.session.completed"
    | "checkout.session.expired";
  kind: "COMPLETE" | "EXPIRE" | "REFUND" | "REVOKE";
  livemode: boolean;
  mode: "payment";
  paymentIntentId: string | null;
  priceId: string;
  season: ApplicationSeason;
  sessionId: string;
  userBindingHmac: string;
};

export class StripeLifecycleVerificationError extends Error {
  readonly kind: "PERMANENT" | "TRANSIENT" | "UNRELATED";

  constructor(kind: "PERMANENT" | "TRANSIENT" | "UNRELATED") {
    super(kind);
    this.name = "StripeLifecycleVerificationError";
    this.kind = kind;
  }
}

export interface StripeLifecycleVerifier {
  verify(
    candidate: Extract<
      StripeWebhookCandidate,
      { kind: "CHECKOUT" | "REVERSAL" }
    >,
  ): Promise<VerifiedStripeLifecycle>;
}

type Dependencies = {
  events: StripeEventRepository;
  hmacSecrets: HmacSecrets;
  lifecycle: StripeLifecycleVerifier;
  webhook: StripeWebhookAdapter;
};

function emptyCommit(candidate: StripeWebhookCandidate) {
  return {
    amountCents: null,
    bindingId: candidate.kind === "CHECKOUT" ? candidate.bindingId : null,
    chargeId: candidate.kind === "REVERSAL" ? candidate.chargeId : null,
    currency: null,
    customerId: null,
    eventCreatedAt: candidate.eventCreatedAt,
    eventId: candidate.eventId,
    eventType: candidate.type,
    livemode: candidate.livemode,
    mode: null,
    paymentIntentId:
      candidate.kind === "REVERSAL" ? candidate.paymentIntentId : null,
    priceId: null,
    season: null,
    sessionId: candidate.kind === "CHECKOUT" ? candidate.sessionId : null,
    userBindingHmac: null,
  } as const;
}

export async function processStripeWebhook(
  rawBody: Uint8Array,
  signatureHeader: string,
  dependencies: Dependencies,
  now = new Date(),
): Promise<"ACKNOWLEDGED" | "RETRY"> {
  const candidate = dependencies.webhook.parse(rawBody, signatureHeader, now);
  const payloadHmac = createContentHmac(
    Buffer.from(rawBody).toString("base64url"),
    dependencies.hmacSecrets,
  );
  if (candidate.kind === "UNSUPPORTED" || candidate.kind === "INVALID") {
    const invalid = candidate.kind === "INVALID";
    await dependencies.events.commit({
      ...emptyCommit(candidate),
      action: "REJECT",
      alertOperator: invalid,
      now,
      payloadHmac,
      safeFailureCode: invalid
        ? "PROVIDER_CONTRACT_MISMATCH"
        : "UNSUPPORTED_EVENT",
    });
    return "ACKNOWLEDGED";
  }

  let verified: VerifiedStripeLifecycle;
  try {
    verified = await dependencies.lifecycle.verify(candidate);
  } catch (error) {
    const known = error instanceof StripeLifecycleVerificationError;
    const transient = !known || error.kind === "TRANSIENT";
    const unrelated = known && error.kind === "UNRELATED";
    const decision = await dependencies.events.commit({
      ...emptyCommit(candidate),
      action: transient ? "RETRY" : "REJECT",
      alertOperator: !known || error.kind === "PERMANENT",
      now,
      payloadHmac,
      safeFailureCode: transient
        ? known
          ? "PROVIDER_RETRIEVAL_FAILED"
          : "INTERNAL_PROCESSING_FAILED"
        : unrelated
          ? "UNRELATED_EVENT"
          : "PROVIDER_CONTRACT_MISMATCH",
    });
    return decision.type === "RETRY_PENDING" ? "RETRY" : "ACKNOWLEDGED";
  }

  const decision = await dependencies.events.commit({
    action: verified.kind,
    alertOperator: false,
    amountCents: verified.amountCents,
    bindingId: verified.bindingId,
    chargeId: verified.chargeId,
    currency: verified.currency,
    customerId: verified.customerId,
    eventCreatedAt: verified.eventCreatedAt,
    eventId: verified.eventId,
    eventType: verified.eventType,
    livemode: verified.livemode,
    mode: verified.mode,
    now,
    payloadHmac,
    paymentIntentId: verified.paymentIntentId,
    priceId: verified.priceId,
    safeFailureCode: null,
    season: verified.season,
    sessionId: verified.sessionId,
    userBindingHmac: verified.userBindingHmac,
  });
  return decision.type === "RETRY_PENDING" ? "RETRY" : "ACKNOWLEDGED";
}
