import type { EssayId } from "@/contracts/domain/ids";
import type { Essay, EssayStatus } from "@/contracts/http/v1/essays";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { OutlineV1 } from "@/contracts/http/v1/outlines";
import type { EssayVersionRepository } from "@/repositories/essay-version-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type SaveDraftErrorCode = Extract<
  ErrorCode,
  "RESOURCE_NOT_FOUND" | "REVISION_MISMATCH" | "STATE_CONFLICT"
>;

export class SaveDraftError extends Error {
  readonly code: SaveDraftErrorCode;
  constructor(code: SaveDraftErrorCode) {
    super(code);
    this.name = "SaveDraftError";
    this.code = code;
  }
}

export function normalizeDraftText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").normalize("NFC");
}

export async function saveEssayDraft(
  essayId: EssayId,
  expectedRevision: number,
  patch: { draftText?: string; outline?: OutlineV1; status?: EssayStatus },
  dependencies: EligibilityDependencies & { versions: EssayVersionRepository },
  now = new Date(),
): Promise<Essay> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const result = await dependencies.versions.save({
    acceptedProposalId: null,
    ...(patch.draftText === undefined
      ? {}
      : { draftText: normalizeDraftText(patch.draftText) }),
    essayId,
    expectedRevision,
    now,
    ...(patch.outline === undefined ? {} : { outline: patch.outline }),
    origin: "AUTOSAVE",
    ...(patch.status === undefined ? {} : { status: patch.status }),
    userId,
  });
  if (result.type !== "UPDATED" && result.type !== "UNCHANGED") {
    throw new SaveDraftError(
      result.type === "NOT_FOUND" ? "RESOURCE_NOT_FOUND" : result.type,
    );
  }
  return result.value;
}
