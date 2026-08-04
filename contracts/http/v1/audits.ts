import { z } from "zod";

import {
  canonicalUuidSchema,
  essayAuditIdSchema,
  essayIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const auditInputSchema = z.strictObject({});
export type AuditInput = z.infer<typeof auditInputSchema>;

export const auditIssueCodeSchema = z.enum([
  "EMPTY_DRAFT",
  "WORD_LIMIT_EXCEEDED",
  "PROMPT_COVERAGE_WEAK",
  "EVIDENCE_MISSING",
  "SCHOOL_CITATION_MISSING",
  "VOICE_PROFILE_MISSING",
  "REPEATED_LANGUAGE",
  "UNSUPPORTED_CLAIM",
  "REFERENCE_CLAIM_UNDECIDED",
  "REJECTED_CLAIM_PRESENT",
  "REFERENCE_SIMILARITY",
]);
export type AuditIssueCode = z.infer<typeof auditIssueCodeSchema>;

export const auditIssueSchema = z
  .strictObject({
    code: auditIssueCodeSchema,
    end: z.number().int().positive().max(20_000).optional(),
    evidenceIds: z.array(canonicalUuidSchema).max(50),
    message: z.string().trim().min(1).max(500),
    severity: z.enum(["BLOCKING", "WARNING", "INFO"]),
    start: z.number().int().nonnegative().max(19_999).optional(),
  })
  .superRefine((issue, context) => {
    if ((issue.start === undefined) !== (issue.end === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Issue spans require both start and end",
        path: ["start"],
      });
    }
    if (
      issue.start !== undefined &&
      issue.end !== undefined &&
      issue.end <= issue.start
    ) {
      context.addIssue({
        code: "custom",
        message: "Issue end must be greater than start",
        path: ["end"],
      });
    }
  });
export type AuditIssue = z.infer<typeof auditIssueSchema>;

export const similarityThresholdCodeSchema = z.enum([
  "NO_REFERENCE",
  "SHORT_IDENTICAL",
  "SHORT_DISTINCT",
  "FOUR_GRAM_OVERLAP",
  "CONTIGUOUS_MATCH",
  "BELOW_THRESHOLD",
]);
export type SimilarityThresholdCode = z.infer<
  typeof similarityThresholdCodeSchema
>;

export const similarityMetricsSchema = z
  .strictObject({
    distinctReferenceFourGramCount: z.number().int().nonnegative(),
    fourGramOverlapRatio: z.number().min(0).max(1),
    longestContiguousMatch: z.number().int().nonnegative(),
    matchedReferenceFourGramCount: z.number().int().nonnegative(),
    referenceTokenCount: z.number().int().nonnegative(),
    studentTokenCount: z.number().int().nonnegative(),
    substantiallySimilar: z.boolean(),
    thresholdCode: similarityThresholdCodeSchema,
  })
  .superRefine((metrics, context) => {
    const expectedRatio = metrics.distinctReferenceFourGramCount
      ? metrics.matchedReferenceFourGramCount /
        metrics.distinctReferenceFourGramCount
      : 0;
    if (
      metrics.matchedReferenceFourGramCount >
        metrics.distinctReferenceFourGramCount ||
      Math.abs(metrics.fourGramOverlapRatio - expectedRatio) > 1e-12
    ) {
      context.addIssue({
        code: "custom",
        message: "Four-gram metrics are inconsistent",
        path: ["fourGramOverlapRatio"],
      });
    }
    const codeIsBlocking = [
      "SHORT_IDENTICAL",
      "FOUR_GRAM_OVERLAP",
      "CONTIGUOUS_MATCH",
    ].includes(metrics.thresholdCode);
    if (metrics.substantiallySimilar !== codeIsBlocking) {
      context.addIssue({
        code: "custom",
        message: "Similarity status must match its threshold code",
        path: ["substantiallySimilar"],
      });
    }
  });
export type SimilarityMetrics = z.infer<typeof similarityMetricsSchema>;

export const essayAuditSchema = z
  .strictObject({
    createdAt: rfc3339UtcSchema,
    essayId: essayIdSchema,
    essayRevision: z.number().int().nonnegative(),
    evidenceManifestVersion: z
      .string()
      .regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/),
    id: essayAuditIdSchema,
    issues: z.array(auditIssueSchema).max(100),
    similarity: similarityMetricsSchema,
    status: z.enum(["PASS", "BLOCKED"]),
    userId: userIdSchema,
  })
  .superRefine((audit, context) => {
    const hasBlocker = audit.issues.some(
      (issue) => issue.severity === "BLOCKING",
    );
    if ((audit.status === "BLOCKED") !== hasBlocker) {
      context.addIssue({
        code: "custom",
        message: "Audit status must match its blocking issues",
        path: ["status"],
      });
    }
  });
export type EssayAudit = z.infer<typeof essayAuditSchema>;
