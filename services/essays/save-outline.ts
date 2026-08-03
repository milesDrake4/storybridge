import type { EssayId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { Essay } from "@/contracts/http/v1/essays";
import type { OutlineV1 } from "@/contracts/http/v1/outlines";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type SaveOutlineErrorCode = Extract<
  ErrorCode,
  "RESOURCE_NOT_FOUND" | "REVISION_MISMATCH" | "STATE_CONFLICT"
>;

export class SaveOutlineError extends Error {
  readonly code: SaveOutlineErrorCode;
  constructor(code: SaveOutlineErrorCode) {
    super(code);
    this.name = "SaveOutlineError";
    this.code = code;
  }
}

export async function saveEssayOutline(
  essayId: EssayId,
  expectedRevision: number,
  outline: OutlineV1,
  dependencies: EligibilityDependencies & { essays: EssayWorkspaceRepository },
  now = new Date(),
): Promise<Essay> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const result = await dependencies.essays.updateOutline({
    essayId,
    expectedRevision,
    now,
    outline,
    userId,
  });
  if (result.type !== "UPDATED") {
    throw new SaveOutlineError(
      result.type === "NOT_FOUND" ? "RESOURCE_NOT_FOUND" : result.type,
    );
  }
  return result.value;
}
