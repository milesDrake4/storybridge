import {
  checkoutBindingIdSchema,
  type CheckoutBindingId,
} from "@/contracts/domain/ids";
import {
  checkoutSessionResponseSchema,
  type CheckoutSessionResponse,
  type CreateCheckoutSessionInput,
} from "@/contracts/http/v1/billing";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { HmacSecrets } from "@/lib/config/server";
import { createContentHmac, createIdempotencyHmac } from "@/lib/security/hmac";
import type { CheckoutSessionRepository } from "@/repositories/checkout-session-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";
import {
  StripeCheckoutError,
  type StripeCheckoutPort,
} from "@/services/billing/stripe-checkout-port";

const CHECKOUT_LIFETIME_MS = 60 * 60_000;

type BillingErrorCode = Extract<
  ErrorCode,
  | "IDEMPOTENCY_KEY_REUSED"
  | "PROVIDER_INVALID_RESPONSE"
  | "SERVICE_UNAVAILABLE"
  | "STATE_CONFLICT"
>;

export class BillingError extends Error {
  readonly code: BillingErrorCode;

  constructor(code: BillingErrorCode) {
    super(code);
    this.name = "BillingError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  appUrl: URL;
  currency: "usd";
  hmacSecrets: HmacSecrets;
  priceCents: number;
  priceId: string;
  sessions: CheckoutSessionRepository;
  stripe: StripeCheckoutPort;
};

function checkoutPageUrl(appUrl: URL, state: "cancelled" | "completed") {
  const url = new URL("/essays", appUrl);
  url.searchParams.set("checkout", state);
  return url.toString();
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
  request: { idempotencyKey: string },
  dependencies: Dependencies,
  now = new Date(),
  createBindingId: () => CheckoutBindingId = () =>
    checkoutBindingIdSchema.parse(crypto.randomUUID()),
): Promise<CheckoutSessionResponse> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const bindingId = createBindingId();
  const expiresAt = new Date(
    Math.floor((now.getTime() + CHECKOUT_LIFETIME_MS) / 1_000) * 1_000,
  );
  const normalized = { season: input.season };
  const userBindingHmac = createContentHmac(
    `stripe-user:${userId}`,
    dependencies.hmacSecrets,
  );

  const reservation = await dependencies.sessions.reserve({
    amountCents: dependencies.priceCents,
    bindingId,
    currency: dependencies.currency,
    expiresAt,
    idempotencyKeyHmac: createIdempotencyHmac(
      `${userId}:POST:/api/v1/billing/checkout-sessions:${request.idempotencyKey}`,
      dependencies.hmacSecrets,
    ),
    mode: "payment",
    now,
    priceId: dependencies.priceId,
    requestHmac: createContentHmac(
      JSON.stringify(normalized),
      dependencies.hmacSecrets,
    ),
    season: input.season,
    userBindingHmac,
    userId,
  });

  if (reservation.type === "READY") {
    return checkoutSessionResponseSchema.parse({
      checkoutUrl: reservation.checkoutUrl,
      expiresAt: reservation.expiresAt.toISOString(),
    });
  }
  if (reservation.type !== "PENDING") {
    throw new BillingError(reservation.type);
  }

  let created: Awaited<ReturnType<StripeCheckoutPort["createSession"]>>;
  try {
    created = await dependencies.stripe.createSession({
      amountCents: dependencies.priceCents,
      bindingId: reservation.bindingId,
      cancelUrl: checkoutPageUrl(dependencies.appUrl, "cancelled"),
      currency: dependencies.currency,
      expiresAt: reservation.expiresAt,
      idempotencyKey: `storybridge-checkout:${reservation.bindingId}`,
      metadata: {
        storybridge_binding_id: reservation.bindingId,
        storybridge_season: input.season,
        storybridge_user_binding: userBindingHmac,
      },
      mode: "payment",
      priceId: dependencies.priceId,
      successUrl: checkoutPageUrl(dependencies.appUrl, "completed"),
    });
  } catch (error) {
    throw new BillingError(
      error instanceof StripeCheckoutError && error.kind === "INVALID_RESPONSE"
        ? "PROVIDER_INVALID_RESPONSE"
        : "SERVICE_UNAVAILABLE",
    );
  }

  const finalized = await dependencies.sessions.finalize({
    bindingId: reservation.bindingId,
    checkoutUrl: created.checkoutUrl,
    customerId: created.customerId,
    expiresAt: created.expiresAt,
    now,
    sessionId: created.sessionId,
  });
  if (finalized.type === "NOT_FOUND" || finalized.type === "STATE_CONFLICT") {
    throw new BillingError("STATE_CONFLICT");
  }
  return checkoutSessionResponseSchema.parse({
    checkoutUrl: created.checkoutUrl,
    expiresAt: created.expiresAt.toISOString(),
  });
}
