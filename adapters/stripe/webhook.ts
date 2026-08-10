import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { checkoutBindingIdSchema } from "@/contracts/domain/ids";

const SIGNATURE_TOLERANCE_SECONDS = 300;

const eventSchema = z.object({
  created: z.number().int().positive(),
  data: z.object({ object: z.unknown() }),
  id: z.string().startsWith("evt_"),
  livemode: z.boolean(),
  object: z.literal("event"),
  type: z.string().min(1).max(200),
});

const metadataSchema = z.record(z.string(), z.string());
const checkoutObjectSchema = z.object({
  id: z.string().startsWith("cs_"),
  metadata: metadataSchema,
  object: z.literal("checkout.session"),
});
const chargeObjectSchema = z.object({
  amount: z.number().int().positive(),
  amount_refunded: z.number().int().positive(),
  currency: z.string().length(3),
  id: z.string().startsWith("ch_"),
  object: z.literal("charge"),
  payment_intent: z.string().startsWith("pi_").nullable(),
});
const disputeObjectSchema = z.object({
  amount: z.number().int().positive(),
  charge: z.string().startsWith("ch_"),
  currency: z.string().length(3),
  id: z.string().startsWith("dp_"),
  object: z.literal("dispute"),
  payment_intent: z.string().startsWith("pi_").nullable(),
});

export class StripeWebhookSignatureError extends Error {
  constructor() {
    super("Invalid Stripe webhook signature");
    this.name = "StripeWebhookSignatureError";
  }
}

export class StripeWebhookPayloadError extends Error {
  constructor() {
    super("Invalid Stripe webhook payload");
    this.name = "StripeWebhookPayloadError";
  }
}

export type StripeWebhookCandidate =
  | {
      eventCreatedAt: Date;
      eventId: string;
      kind: "INVALID";
      livemode: boolean;
      type:
        | "charge.dispute.created"
        | "charge.refunded"
        | "checkout.session.completed"
        | "checkout.session.expired";
    }
  | {
      bindingId: ReturnType<typeof checkoutBindingIdSchema.parse> | null;
      eventCreatedAt: Date;
      eventId: string;
      kind: "CHECKOUT";
      livemode: boolean;
      metadata: Record<string, string>;
      sessionId: string;
      type: "checkout.session.completed" | "checkout.session.expired";
    }
  | {
      amountCents: number;
      chargeId: string;
      currency: string;
      eventCreatedAt: Date;
      eventId: string;
      kind: "REVERSAL";
      livemode: boolean;
      paymentIntentId: string | null;
      type: "charge.dispute.created" | "charge.refunded";
    }
  | {
      eventCreatedAt: Date;
      eventId: string;
      kind: "UNSUPPORTED";
      livemode: boolean;
      type: string;
    };

function parseSignatureHeader(header: string) {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[a-f0-9]{64}$/.test(value)) signatures.push(value);
  }
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) {
    throw new StripeWebhookSignatureError();
  }
  return { signatures, timestamp: timestamp as number };
}

function verifySignature(
  rawBody: Uint8Array,
  header: string,
  secret: string,
  now: Date,
) {
  const { signatures, timestamp } = parseSignatureHeader(header);
  if (
    Math.abs(Math.floor(now.getTime() / 1_000) - timestamp) >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new StripeWebhookSignatureError();
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`, "utf8")
    .update(rawBody)
    .digest();
  const matches = signatures.some((signature) =>
    timingSafeEqual(expected, Buffer.from(signature, "hex")),
  );
  if (!matches) throw new StripeWebhookSignatureError();
}

function optionalBinding(metadata: Record<string, string>) {
  const parsed = checkoutBindingIdSchema.safeParse(
    metadata.storybridge_binding_id,
  );
  return parsed.success ? parsed.data : null;
}

export function createStripeWebhookAdapter(secret: string) {
  return {
    parse(
      rawBody: Uint8Array,
      signatureHeader: string,
      now = new Date(),
    ): StripeWebhookCandidate {
      verifySignature(rawBody, signatureHeader, secret, now);
      let unknownEvent: unknown;
      try {
        unknownEvent = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
        );
      } catch {
        throw new StripeWebhookPayloadError();
      }
      const parsedEvent = eventSchema.safeParse(unknownEvent);
      if (!parsedEvent.success) throw new StripeWebhookPayloadError();
      const event = parsedEvent.data;
      const common = {
        eventCreatedAt: new Date(event.created * 1_000),
        eventId: event.id,
        livemode: event.livemode,
      };
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.expired"
      ) {
        const parsedObject = checkoutObjectSchema.safeParse(event.data.object);
        if (!parsedObject.success) {
          return { ...common, kind: "INVALID", type: event.type };
        }
        const object = parsedObject.data;
        return {
          ...common,
          bindingId: optionalBinding(object.metadata),
          kind: "CHECKOUT",
          metadata: object.metadata,
          sessionId: object.id,
          type: event.type,
        };
      }
      if (event.type === "charge.refunded") {
        const parsedObject = chargeObjectSchema.safeParse(event.data.object);
        if (!parsedObject.success) {
          return { ...common, kind: "INVALID", type: event.type };
        }
        const object = parsedObject.data;
        return {
          ...common,
          amountCents: object.amount_refunded,
          chargeId: object.id,
          currency: object.currency,
          kind: "REVERSAL",
          paymentIntentId: object.payment_intent,
          type: event.type,
        };
      }
      if (event.type === "charge.dispute.created") {
        const parsedObject = disputeObjectSchema.safeParse(event.data.object);
        if (!parsedObject.success) {
          return { ...common, kind: "INVALID", type: event.type };
        }
        const object = parsedObject.data;
        return {
          ...common,
          amountCents: object.amount,
          chargeId: object.charge,
          currency: object.currency,
          kind: "REVERSAL",
          paymentIntentId: object.payment_intent,
          type: event.type,
        };
      }
      return { ...common, kind: "UNSUPPORTED", type: event.type };
    },
  };
}

export type StripeWebhookAdapter = ReturnType<
  typeof createStripeWebhookAdapter
>;
