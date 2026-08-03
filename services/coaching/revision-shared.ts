import { AiAdapterError } from "@/adapters/openai/structured-response";
import type {
  GeneratedClaim,
  RewriteInstruction,
} from "@/contracts/http/v1/proposals";
import type { ErrorCode } from "@/contracts/http/v1/errors";

export type RevisionProposalErrorCode = Extract<
  ErrorCode,
  | "INSUFFICIENT_EVIDENCE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REFUSED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_MISMATCH"
  | "SERVICE_UNAVAILABLE"
  | "STATE_CONFLICT"
  | "VALIDATION_ERROR"
>;

export class RevisionProposalError extends Error {
  readonly code: RevisionProposalErrorCode;
  constructor(code: RevisionProposalErrorCode) {
    super(code);
    this.name = "RevisionProposalError";
    this.code = code;
  }
}

export function providerErrorCode(error: unknown): RevisionProposalErrorCode {
  if (error instanceof AiAdapterError && error.code === "PROVIDER_REFUSED") {
    return "PROVIDER_REFUSED";
  }
  if (
    error instanceof AiAdapterError &&
    error.code === "PROVIDER_INVALID_RESPONSE"
  ) {
    return "PROVIDER_INVALID_RESPONSE";
  }
  return "SERVICE_UNAVAILABLE";
}

export function claimsUseAllowedEvidence(
  claims: GeneratedClaim[],
  storyFactIds: Set<string>,
  schoolSourceIds: Set<string>,
): boolean {
  return claims.every(
    (claim) =>
      claim.storyFactIds.every((id) => storyFactIds.has(id)) &&
      claim.schoolSourceIds.every((id) => schoolSourceIds.has(id)),
  );
}

export function proposalText(claims: GeneratedClaim[], texts: string[]) {
  return [...texts, ...claims.map((claim) => claim.text)];
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

export function rewriteLengthIsValid(
  selectedText: string,
  proposedText: string,
  instruction: RewriteInstruction,
): boolean {
  const selectedWords = Math.max(1, wordCount(selectedText));
  const proposedWords = wordCount(proposedText);
  const maximum =
    instruction === "TIGHTEN"
      ? selectedWords
      : instruction === "EXPAND"
        ? selectedWords * 2
        : Math.ceil(selectedWords * 1.25);
  return proposedWords <= maximum;
}
