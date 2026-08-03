import { z } from "zod";

import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const schoolResearchCategorySchema = z.enum([
  "ACADEMICS",
  "PROGRAMS",
  "CULTURE",
  "COMMUNITY",
  "OPPORTUNITIES",
  "VALUES",
  "ADMISSIONS",
]);
export type SchoolResearchCategory = z.infer<
  typeof schoolResearchCategorySchema
>;

const sourceBase = {
  category: schoolResearchCategorySchema,
  claim: z.string().trim().min(1).max(500),
  retrievedAt: rfc3339UtcSchema,
  supportingExcerpt: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
};

export const rawSchoolResearchSourceSchema = z.strictObject({
  ...sourceBase,
  url: z.url().max(2_048),
});

export const rawSchoolResearchOutputSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  sources: z.array(rawSchoolResearchSourceSchema).min(1).max(20),
  summary: z.string().trim().min(1).max(1_500),
});
export type RawSchoolResearchOutput = z.infer<
  typeof rawSchoolResearchOutputSchema
>;

export const schoolDossierSourceDraftSchema = z.strictObject({
  ...sourceBase,
  normalizedUrl: z.url().max(2_048),
});

export const schoolDossierDraftSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  sources: z.array(schoolDossierSourceDraftSchema).min(1).max(20),
  summary: z.string().trim().min(1).max(1_500),
});
export type SchoolDossierDraft = z.infer<typeof schoolDossierDraftSchema>;
