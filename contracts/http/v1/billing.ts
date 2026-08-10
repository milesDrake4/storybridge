import { z } from "zod";

import { applicationSeasonSchema } from "@/contracts/http/v1/essays";

export const createCheckoutSessionInputSchema = z.strictObject({
  season: applicationSeasonSchema,
});
export type CreateCheckoutSessionInput = z.infer<
  typeof createCheckoutSessionInputSchema
>;

const stripeCheckoutUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
    context.addIssue({
      code: "custom",
      message: "Checkout URL must be hosted by Stripe",
    });
  }
});

export const checkoutSessionResponseSchema = z.strictObject({
  checkoutUrl: stripeCheckoutUrlSchema,
  expiresAt: z.iso.datetime({ offset: true }),
});
export type CheckoutSessionResponse = z.infer<
  typeof checkoutSessionResponseSchema
>;
