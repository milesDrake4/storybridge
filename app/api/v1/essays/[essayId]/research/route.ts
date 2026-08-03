import {
  createDossierGetHandler,
  createDossierPostHandler,
} from "@/app/api/v1/essays/research-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import {
  createEssayDossier,
  getEssayDossier,
} from "@/services/research/create-dossier";
import { refreshEssayDossier } from "@/services/research/refresh-dossier";

type Context = { params: Promise<{ essayId: string }> };

export async function GET(_request: Request, context: Context) {
  const { dependencies } = await createEssayWorkspaceRuntime();
  return createDossierGetHandler({
    get: (essayId) => getEssayDossier(essayId, dependencies),
  })((await context.params).essayId);
}

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createDossierPostHandler({
    appUrl: config.appUrl,
    create: (essayId, metadata) =>
      createEssayDossier(essayId, metadata, dependencies),
    refresh: (essayId, revision, metadata) =>
      refreshEssayDossier(essayId, revision, metadata, dependencies),
  })(request, (await context.params).essayId);
}
