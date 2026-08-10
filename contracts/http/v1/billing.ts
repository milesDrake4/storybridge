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

export const entitlementKindSchema = z.enum(["FREE", "SEASON_PASS"]);
export const entitlementStatusSchema = z.enum([
  "ACTIVE",
  "EXPIRED",
  "REFUNDED",
  "REVOKED",
]);
export const billingEntitlementSchema = z
  .strictObject({
    essayLimit: z.number().int().min(1).max(100),
    essaysRemaining: z.number().int().min(0).max(100),
    essaysUsed: z.number().int().min(0).max(100),
    kind: entitlementKindSchema,
    season: applicationSeasonSchema,
    seasonPassStatus: entitlementStatusSchema.nullable(),
    status: entitlementStatusSchema,
  })
  .superRefine((entitlement, context) => {
    const expectedRemaining =
      entitlement.status === "ACTIVE"
        ? Math.max(entitlement.essayLimit - entitlement.essaysUsed, 0)
        : 0;
    if (entitlement.essaysRemaining !== expectedRemaining) {
      context.addIssue({
        code: "custom",
        message: "Remaining allowance does not match current usage",
        path: ["essaysRemaining"],
      });
    }
    if (
      entitlement.kind === "SEASON_PASS" &&
      (entitlement.status !== "ACTIVE" ||
        entitlement.seasonPassStatus !== "ACTIVE")
    ) {
      context.addIssue({
        code: "custom",
        message: "Only an active season pass can be the effective entitlement",
        path: ["kind"],
      });
    }
  });
export type BillingEntitlement = z.infer<typeof billingEntitlementSchema>;
