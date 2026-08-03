import { z } from "zod";

import {
  essayAngleIdSchema,
  essayIdSchema,
  schoolDossierIdSchema,
  schoolDossierSourceIdSchema,
  storyFactIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const angleGenerationInputSchema = z.strictObject({
  regenerate: z.boolean(),
});
export type AngleGenerationInput = z.infer<typeof angleGenerationInputSchema>;

export const essayAngleDraftSchema = z.strictObject({
  promptFit: z.string().trim().min(1).max(600),
  risk: z.string().trim().min(1).max(400),
  schoolSourceIds: z
    .array(schoolDossierSourceIdSchema)
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
  storyFactIds: z
    .array(storyFactIdSchema)
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
  thesis: z.string().trim().min(1).max(800),
  title: z.string().trim().min(1).max(160),
});
export type EssayAngleDraft = z.infer<typeof essayAngleDraftSchema>;

export const angleGenerationOutputSchema = z
  .strictObject({
    angles: z.array(essayAngleDraftSchema).max(3),
    followUpQuestion: z.string().trim().min(1).max(300).nullable(),
    status: z.enum(["READY", "INSUFFICIENT_EVIDENCE"]),
  })
  .superRefine((value, context) => {
    if (value.status === "READY") {
      if (value.angles.length !== 3 || value.followUpQuestion !== null) {
        context.addIssue({
          code: "custom",
          message: "Ready output requires exactly three angles",
        });
      }
      if (
        new Set(
          value.angles.map(
            (angle) =>
              `${angle.title.normalize("NFKC").toLowerCase()}\n${angle.thesis
                .normalize("NFKC")
                .toLowerCase()}`,
          ),
        ).size !== value.angles.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Angles must be materially distinct",
        });
      }
    } else if (value.angles.length !== 0 || value.followUpQuestion === null) {
      context.addIssue({
        code: "custom",
        message: "Insufficient evidence requires one follow-up and no angles",
      });
    }
  });
export type AngleGenerationOutput = z.infer<typeof angleGenerationOutputSchema>;

export const essayAngleSchema = essayAngleDraftSchema.extend({
  createdAt: rfc3339UtcSchema,
  dossierId: schoolDossierIdSchema,
  essayId: essayIdSchema,
  id: essayAngleIdSchema,
  position: z.number().int().min(1).max(3),
  selectedAt: rfc3339UtcSchema.nullable(),
  updatedAt: rfc3339UtcSchema,
  userId: userIdSchema,
});
export type EssayAngle = z.infer<typeof essayAngleSchema>;

export const essayAngleSetSchema = z.strictObject({
  angles: z.tuple([essayAngleSchema, essayAngleSchema, essayAngleSchema]),
});
export type EssayAngleSet = z.infer<typeof essayAngleSetSchema>;
