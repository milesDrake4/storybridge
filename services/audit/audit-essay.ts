import { randomUUID } from "node:crypto";

import { essayAuditIdSchema, type EssayId } from "@/contracts/domain/ids";
import type {
  AuditIssue,
  EssayAudit,
  SimilarityMetrics,
} from "@/contracts/http/v1/audits";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import { tokenizeSimilarityText } from "@/domain/audit/similarity";
import type { HmacSecrets } from "@/lib/config/server";
import { createContentHmac, createIdempotencyHmac } from "@/lib/security/hmac";
import type {
  AuditContext,
  EssayAuditRepository,
} from "@/repositories/essay-audit-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type AuditEssayErrorCode = Extract<
  ErrorCode,
  | "IDEMPOTENCY_KEY_REUSED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_MISMATCH"
  | "SERVICE_UNAVAILABLE"
  | "STATE_CONFLICT"
>;

export class AuditEssayError extends Error {
  readonly code: AuditEssayErrorCode;
  constructor(code: AuditEssayErrorCode) {
    super(code);
    this.name = "AuditEssayError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  audits: EssayAuditRepository;
  hmacSecrets: HmacSecrets;
  similarity: {
    measure(studentText: string, referenceText: string): SimilarityMetrics;
    noReference(studentText: string): SimilarityMetrics;
  };
};

const PROMPT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "describe",
  "do",
  "for",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function issue(
  code: AuditIssue["code"],
  severity: AuditIssue["severity"],
  message: string,
  evidenceIds: string[] = [],
): AuditIssue {
  return { code, evidenceIds, message, severity };
}

function containsTokenSequence(text: string, phrase: string): boolean {
  const textTokens = tokenizeSimilarityText(text);
  const phraseTokens = tokenizeSimilarityText(phrase);
  if (!phraseTokens.length || phraseTokens.length > textTokens.length) {
    return false;
  }
  return textTokens.some((_, start) =>
    phraseTokens.every((token, offset) => textTokens[start + offset] === token),
  );
}

function hasRepeatedFourGram(text: string): boolean {
  const tokens = tokenizeSimilarityText(text);
  const counts = new Map<string, number>();
  for (let index = 0; index <= tokens.length - 4; index += 1) {
    const gram = tokens.slice(index, index + 4).join("\u0000");
    const count = (counts.get(gram) ?? 0) + 1;
    if (count >= 3) return true;
    counts.set(gram, count);
  }
  return false;
}

function buildIssues(
  context: AuditContext,
  similarity: SimilarityMetrics,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const draftTokens = tokenizeSimilarityText(context.essay.draftText);
  if (!draftTokens.length) {
    issues.push(
      issue(
        "EMPTY_DRAFT",
        "BLOCKING",
        "Write a student-authored draft before final review.",
      ),
    );
  }
  if (draftTokens.length > context.essay.wordLimit) {
    issues.push(
      issue(
        "WORD_LIMIT_EXCEEDED",
        "BLOCKING",
        `The draft has ${draftTokens.length} words and exceeds the ${context.essay.wordLimit}-word limit.`,
      ),
    );
  }

  const draftVocabulary = new Set(draftTokens);
  const promptKeywords = tokenizeSimilarityText(context.essay.prompt).filter(
    (token) => token.length >= 3 && !PROMPT_STOP_WORDS.has(token),
  );
  if (
    draftTokens.length > 0 &&
    promptKeywords.length > 0 &&
    !promptKeywords.some((token) => draftVocabulary.has(token))
  ) {
    issues.push(
      issue(
        "PROMPT_COVERAGE_WEAK",
        "WARNING",
        "The draft does not yet use the prompt’s central language; verify that it answers the question directly.",
      ),
    );
  }

  if (
    context.invalidEvidenceIds.length > 0 ||
    (draftTokens.length > 0 &&
      context.storyFactIds.length === 0 &&
      context.schoolSourceIds.length === 0)
  ) {
    issues.push(
      issue(
        "EVIDENCE_MISSING",
        "BLOCKING",
        "The current outline needs verified Story Vault or school evidence.",
        context.invalidEvidenceIds,
      ),
    );
  }
  if (context.schoolSourceIds.length === 0) {
    issues.push(
      issue(
        "SCHOOL_CITATION_MISSING",
        "WARNING",
        "The current outline has no cited school source; verify school-specific statements.",
      ),
    );
  }
  if (!context.hasVoiceProfile) {
    issues.push(
      issue(
        "VOICE_PROFILE_MISSING",
        "WARNING",
        "No current Story Vault voice profile is available for the voice-consistency check.",
      ),
    );
  }
  if (hasRepeatedFourGram(context.essay.draftText)) {
    issues.push(
      issue(
        "REPEATED_LANGUAGE",
        "WARNING",
        "A four-word phrase appears at least three times; review it for repetitive or generic language.",
      ),
    );
  }

  for (const claim of context.unsupportedClaims) {
    if (containsTokenSequence(context.essay.draftText, claim.text)) {
      issues.push(
        issue(
          "UNSUPPORTED_CLAIM",
          "BLOCKING",
          "A factual claim in the current draft is not linked to verified evidence.",
          claim.evidenceIds,
        ),
      );
    }
  }
  for (const claim of context.referenceDraft?.claims ?? []) {
    if (claim.decision === null) {
      issues.push(
        issue(
          "REFERENCE_CLAIM_UNDECIDED",
          "BLOCKING",
          "Review every factual claim in the AI reference draft before export.",
          [claim.id],
        ),
      );
    } else if (
      claim.decision === "REJECTED" &&
      containsTokenSequence(context.essay.draftText, claim.text)
    ) {
      issues.push(
        issue(
          "REJECTED_CLAIM_PRESENT",
          "BLOCKING",
          "A rejected reference claim is still present in the student draft.",
          [claim.id],
        ),
      );
    }
  }
  if (similarity.substantiallySimilar) {
    issues.push(
      issue(
        "REFERENCE_SIMILARITY",
        "BLOCKING",
        "The student draft is substantially similar to the AI reference draft and requires meaningful revision.",
      ),
    );
  }
  return issues;
}

export async function auditEssay(
  essayId: EssayId,
  request: { idempotencyKey: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<EssayAudit> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const context = await dependencies.audits.loadContext(userId, essayId);
  if (!context) throw new AuditEssayError("RESOURCE_NOT_FOUND");

  let similarity: SimilarityMetrics;
  try {
    similarity = context.referenceDraft
      ? dependencies.similarity.measure(
          context.essay.draftText,
          context.referenceDraft.referenceText,
        )
      : dependencies.similarity.noReference(context.essay.draftText);
  } catch {
    throw new AuditEssayError("SERVICE_UNAVAILABLE");
  }
  const issues = buildIssues(context, similarity);
  const status = issues.some((item) => item.severity === "BLOCKING")
    ? "BLOCKED"
    : "PASS";
  const requestHmac = createContentHmac(
    JSON.stringify({
      essayId,
      essayRevision: context.essay.revision,
      evidenceManifestVersion: context.evidenceManifestVersion,
    }),
    dependencies.hmacSecrets,
  );
  const result = await dependencies.audits.commit({
    auditId: essayAuditIdSchema.parse(randomUUID()),
    essayId,
    essayRevision: context.essay.revision,
    evidenceManifestVersion: context.evidenceManifestVersion,
    expectedDraftText: context.essay.draftText,
    idempotencyKeyHmac: createIdempotencyHmac(
      request.idempotencyKey,
      dependencies.hmacSecrets,
    ),
    issues,
    now,
    requestHmac,
    similarity,
    status,
    userId,
  });
  if (result.type === "CREATED" || result.type === "REPLAY") {
    return result.value;
  }
  const errorByResult = {
    IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
    MANIFEST_MISMATCH: "STATE_CONFLICT",
    NOT_FOUND: "RESOURCE_NOT_FOUND",
    REVISION_MISMATCH: "REVISION_MISMATCH",
  } as const;
  throw new AuditEssayError(errorByResult[result.type]);
}
