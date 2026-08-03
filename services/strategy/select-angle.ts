import type {
  EssayAngle,
  EssayAnglePatch,
} from "@/contracts/domain/essay-angle";
import type { EssayAngleId, EssayId } from "@/contracts/domain/ids";
import type { Essay } from "@/contracts/http/v1/essays";
import type { EssayAngleRepository } from "@/repositories/essay-angle-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";
import { EssayAngleError } from "@/services/strategy/generate-angles";

type Dependencies = EligibilityDependencies & {
  angles: EssayAngleRepository;
  essays: EssayWorkspaceRepository;
};

export async function listEssayAngles(
  essayId: EssayId,
  dependencies: Dependencies,
  now = new Date(),
): Promise<EssayAngle[]> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace) throw new EssayAngleError("RESOURCE_NOT_FOUND");
  return dependencies.angles.list(userId, essayId);
}

export async function selectEssayAngle(
  essayId: EssayId,
  angleId: EssayAngleId,
  dependencies: Dependencies,
  now = new Date(),
): Promise<Essay> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const selected = await dependencies.angles.select({
    angleId,
    essayId,
    now,
    userId,
  });
  if (selected.type === "NOT_FOUND") {
    throw new EssayAngleError("RESOURCE_NOT_FOUND");
  }
  if (selected.type === "STATE_CONFLICT") {
    throw new EssayAngleError("STATE_CONFLICT");
  }
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace || workspace.essay.selectedAngleId !== angleId) {
    throw new EssayAngleError("STATE_CONFLICT");
  }
  return workspace.essay;
}

export async function updateEssayAngle(
  essayId: EssayId,
  angleId: EssayAngleId,
  expectedRevision: number,
  patch: EssayAnglePatch,
  dependencies: Dependencies,
  now = new Date(),
): Promise<{ angle: EssayAngle; essayRevision: number }> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const updated = await dependencies.angles.update({
    angleId,
    essayId,
    expectedRevision,
    now,
    patch,
    userId,
  });
  if (updated.type !== "UPDATED") {
    throw new EssayAngleError(
      updated.type === "NOT_FOUND" ? "RESOURCE_NOT_FOUND" : updated.type,
    );
  }
  const angles = await dependencies.angles.list(userId, essayId);
  const angle = angles.find((candidate) => candidate.id === angleId);
  if (!angle) throw new EssayAngleError("STATE_CONFLICT");
  return { angle, essayRevision: expectedRevision + 1 };
}
