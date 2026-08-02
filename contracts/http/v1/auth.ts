import { z } from "zod";

const normalizedEmailSchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim().toLowerCase())
  .pipe(z.email().max(254));

const relativeRedirectSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
    "Redirect must be a root-relative application path",
  );

export const magicLinkRequestSchema = z.strictObject({
  email: normalizedEmailSchema,
  inviteToken: z.string().min(1).max(256).optional(),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

export const magicLinkAcceptedSchema = z.object({
  accepted: z.literal(true),
});
export type MagicLinkAccepted = z.infer<typeof magicLinkAcceptedSchema>;

export const authCallbackQuerySchema = z.strictObject({
  code: z.string().min(1).max(2_048),
  next: relativeRedirectSchema.optional(),
});
export type AuthCallbackQuery = z.infer<typeof authCallbackQuerySchema>;
