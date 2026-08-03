import type { EssayId } from "@/contracts/domain/ids";
import {
  generateEssayDossier,
  type SchoolDossierResult,
} from "@/services/research/create-dossier";

type GenerateDependencies = Parameters<typeof generateEssayDossier>[2];

export function refreshEssayDossier(
  essayId: EssayId,
  expectedRevision: number,
  request: { idempotencyKey: string; ipAddress: string },
  dependencies: GenerateDependencies,
  now = new Date(),
): Promise<SchoolDossierResult> {
  return generateEssayDossier(
    essayId,
    { ...request, expectedRevision },
    dependencies,
    now,
  );
}
