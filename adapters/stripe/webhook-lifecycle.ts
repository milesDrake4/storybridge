import { z } from "zod";

import { checkoutBindingIdSchema } from "@/contracts/domain/ids";
import { applicationSeasonSchema } from "@/contracts/http/v1/essays";
import {
  StripeLifecycleVerificationError,
  type StripeLifecycleVerifier,
  type VerifiedStripeLifecycle,
} from "@/services/billing/process-webhook";

const metadataSchema = z.record(z.string(), z.string());
const userBindingHmacSchema = z
  .string()
  .regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/);
const chargeReferenceSchema = z.union([
  z.string().startsWith("ch_"),
  z.object({ id: z.string().startsWith("ch_"), object: z.literal("charge") }),
  z.null(),
]);
const paymentIntentSchema = z.object({
  amount_received: z.number().int().nonnegative(),
  currency: z.string().length(3),
  id: z.string().startsWith("pi_"),
  latest_charge: chargeReferenceSchema,
  livemode: z.boolean(),
  metadata: metadataSchema,
  object: z.literal("payment_intent"),
  status: z.string(),
});
const lineItemSchema = z.object({
  amount_total: z.number().int().positive(),
  price: z.union([
    z.string().startsWith("price_"),
    z.object({
      id: z.string().startsWith("price_"),
      object: z.literal("price"),
    }),
  ]),
  quantity: z.number().int().positive().nullable(),
});
const checkoutSessionSchema = z.object({
  amount_total: z.number().int().positive(),
  currency: z.string().length(3),
  customer: z.string().startsWith("cus_").nullable(),
  id: z.string().startsWith("cs_"),
  line_items: z.object({ data: z.array(lineItemSchema).max(2) }),
  livemode: z.boolean(),
  metadata: metadataSchema,
  mode: z.string(),
  object: z.literal("checkout.session"),
  payment_intent: z.union([paymentIntentSchema, z.null()]),
  payment_status: z.string(),
  status: z.string().nullable(),
});
const chargeSchema = z.object({
  amount: z.number().int().positive(),
  amount_refunded: z.number().int().nonnegative(),
  currency: z.string().length(3),
  id: z.string().startsWith("ch_"),
  livemode: z.boolean(),
  object: z.literal("charge"),
  payment_intent: paymentIntentSchema,
  refunded: z.boolean(),
});
const checkoutListSchema = z.object({
  data: z.array(checkoutSessionSchema).max(2),
  object: z.literal("list"),
});

export interface StripeWebhookLifecycleTransport {
  listCheckoutSessions(paymentIntentId: string): Promise<unknown>;
  retrieveCharge(chargeId: string): Promise<unknown>;
  retrieveCheckoutSession(sessionId: string): Promise<unknown>;
}

type ExpectedCheckout = {
  amountCents: number;
  currency: "usd";
  livemode: boolean;
  priceId: string;
};

function permanent(): never {
  throw new StripeLifecycleVerificationError("PERMANENT");
}

function parseProvider<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) permanent();
  return parsed.data;
}

function parseMetadata(metadata: Record<string, string>) {
  const hasStoryBridgeMetadata = Object.keys(metadata).some((key) =>
    key.startsWith("storybridge_"),
  );
  if (!hasStoryBridgeMetadata) {
    throw new StripeLifecycleVerificationError("UNRELATED");
  }
  const parsed = z
    .object({
      storybridge_binding_id: checkoutBindingIdSchema,
      storybridge_season: applicationSeasonSchema,
      storybridge_user_binding: userBindingHmacSchema,
    })
    .safeParse(metadata);
  if (!parsed.success) permanent();
  return parsed.data;
}

function priceId(lineItem: z.output<typeof lineItemSchema>) {
  return typeof lineItem.price === "string"
    ? lineItem.price
    : lineItem.price.id;
}

function chargeId(reference: z.output<typeof chargeReferenceSchema>) {
  return typeof reference === "string" ? reference : (reference?.id ?? null);
}

function verifySession(
  session: z.output<typeof checkoutSessionSchema>,
  expected: ExpectedCheckout,
) {
  const metadata = parseMetadata(session.metadata);
  const [lineItem] = session.line_items.data;
  if (
    session.amount_total !== expected.amountCents ||
    session.currency !== expected.currency ||
    session.livemode !== expected.livemode ||
    session.mode !== "payment" ||
    session.line_items.data.length !== 1 ||
    !lineItem ||
    lineItem.amount_total !== expected.amountCents ||
    lineItem.quantity !== 1 ||
    priceId(lineItem) !== expected.priceId
  ) {
    permanent();
  }
  return metadata;
}

function verifyPaidSession(
  session: z.output<typeof checkoutSessionSchema>,
  expected: ExpectedCheckout,
) {
  const metadata = verifySession(session, expected);
  if (
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.payment_intent === null
  ) {
    permanent();
  }
  const paymentIntent = session.payment_intent;
  const paymentMetadata = parseMetadata(paymentIntent.metadata);
  if (
    paymentIntent.amount_received !== expected.amountCents ||
    paymentIntent.currency !== expected.currency ||
    paymentIntent.livemode !== expected.livemode ||
    paymentIntent.status !== "succeeded" ||
    paymentMetadata.storybridge_binding_id !==
      metadata.storybridge_binding_id ||
    paymentMetadata.storybridge_season !== metadata.storybridge_season ||
    paymentMetadata.storybridge_user_binding !==
      metadata.storybridge_user_binding
  ) {
    permanent();
  }
  return { metadata, paymentIntent };
}

function commonLifecycle(
  candidate: Parameters<StripeLifecycleVerifier["verify"]>[0],
  session: z.output<typeof checkoutSessionSchema>,
  metadata: ReturnType<typeof parseMetadata>,
  expected: ExpectedCheckout,
): Omit<VerifiedStripeLifecycle, "chargeId" | "kind" | "paymentIntentId"> {
  return {
    amountCents: expected.amountCents,
    bindingId: metadata.storybridge_binding_id,
    currency: expected.currency,
    customerId: session.customer,
    eventCreatedAt: candidate.eventCreatedAt,
    eventId: candidate.eventId,
    eventType: candidate.type,
    livemode: expected.livemode,
    mode: "payment",
    priceId: expected.priceId,
    season: metadata.storybridge_season,
    sessionId: session.id,
    userBindingHmac: metadata.storybridge_user_binding,
  };
}

export function createStripeWebhookLifecycleVerifier(
  transport: StripeWebhookLifecycleTransport,
  expected: ExpectedCheckout,
): StripeLifecycleVerifier {
  return {
    async verify(candidate) {
      try {
        if (candidate.livemode !== expected.livemode) permanent();
        if (candidate.kind === "CHECKOUT") {
          const session = parseProvider(
            checkoutSessionSchema,
            await transport.retrieveCheckoutSession(candidate.sessionId),
          );
          if (session.id !== candidate.sessionId) permanent();
          if (candidate.type === "checkout.session.expired") {
            const metadata = verifySession(session, expected);
            if (
              session.status !== "expired" ||
              session.payment_status !== "unpaid" ||
              session.payment_intent !== null
            ) {
              permanent();
            }
            return {
              ...commonLifecycle(candidate, session, metadata, expected),
              chargeId: null,
              kind: "EXPIRE",
              paymentIntentId: null,
            };
          }
          const { metadata, paymentIntent } = verifyPaidSession(
            session,
            expected,
          );
          const latestChargeId = chargeId(paymentIntent.latest_charge);
          if (!latestChargeId) permanent();
          return {
            ...commonLifecycle(candidate, session, metadata, expected),
            chargeId: latestChargeId,
            kind: "COMPLETE",
            paymentIntentId: paymentIntent.id,
          };
        }

        const charge = parseProvider(
          chargeSchema,
          await transport.retrieveCharge(candidate.chargeId),
        );
        if (
          charge.id !== candidate.chargeId ||
          charge.livemode !== expected.livemode ||
          charge.payment_intent.id !== candidate.paymentIntentId ||
          chargeId(charge.payment_intent.latest_charge) !== charge.id ||
          charge.amount !== expected.amountCents ||
          charge.currency !== expected.currency ||
          (candidate.type === "charge.refunded" &&
            (!charge.refunded ||
              charge.amount_refunded !== expected.amountCents)) ||
          candidate.amountCents !== expected.amountCents ||
          candidate.currency !== expected.currency
        ) {
          permanent();
        }
        const sessions = parseProvider(
          checkoutListSchema,
          await transport.listCheckoutSessions(charge.payment_intent.id),
        );
        if (sessions.data.length !== 1) permanent();
        const session = sessions.data[0];
        if (!session) permanent();
        const { metadata, paymentIntent } = verifyPaidSession(
          session,
          expected,
        );
        if (paymentIntent.id !== charge.payment_intent.id) permanent();
        return {
          ...commonLifecycle(candidate, session, metadata, expected),
          chargeId: charge.id,
          kind: candidate.type === "charge.refunded" ? "REFUND" : "REVOKE",
          paymentIntentId: paymentIntent.id,
        };
      } catch (error) {
        if (error instanceof StripeLifecycleVerificationError) throw error;
        throw new StripeLifecycleVerificationError("TRANSIENT");
      }
    },
  };
}

async function getStripeJson(
  url: URL,
  secretKey: string,
  fetchImplementation: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: { authorization: `Bearer ${secretKey}` },
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new StripeLifecycleVerificationError("TRANSIENT");
  }
  if (!response.ok) throw new StripeLifecycleVerificationError("TRANSIENT");
  try {
    return await response.json();
  } catch {
    throw new StripeLifecycleVerificationError("TRANSIENT");
  }
}

export function createStripeWebhookLifecycleHttpTransport(
  secretKey: string,
  fetchImplementation: typeof fetch = fetch,
): StripeWebhookLifecycleTransport {
  const api = "https://api.stripe.com/v1";
  return {
    listCheckoutSessions(paymentIntentId) {
      const url = new URL(`${api}/checkout/sessions`);
      url.searchParams.set("payment_intent", paymentIntentId);
      url.searchParams.set("limit", "2");
      url.searchParams.append("expand[]", "data.line_items.data.price");
      url.searchParams.append("expand[]", "data.payment_intent");
      return getStripeJson(url, secretKey, fetchImplementation);
    },
    retrieveCharge(chargeId) {
      const url = new URL(`${api}/charges/${encodeURIComponent(chargeId)}`);
      url.searchParams.append("expand[]", "payment_intent.latest_charge");
      return getStripeJson(url, secretKey, fetchImplementation);
    },
    retrieveCheckoutSession(sessionId) {
      const url = new URL(
        `${api}/checkout/sessions/${encodeURIComponent(sessionId)}`,
      );
      url.searchParams.append("expand[]", "line_items.data.price");
      url.searchParams.append("expand[]", "payment_intent.latest_charge");
      return getStripeJson(url, secretKey, fetchImplementation);
    },
  };
}
