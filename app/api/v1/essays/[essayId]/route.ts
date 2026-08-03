import {
  createEssayDeleteHandler,
  createEssayGetHandler,
  createEssayPatchHandler,
} from "@/app/api/v1/essays/handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import {
  deleteEssayWorkspace,
  getEssayWorkspace,
} from "@/services/essays/manage-workspaces";
import { saveEssayOutline } from "@/services/essays/save-outline";
import { saveEssayDraft } from "@/services/essays/save-draft";

type Context = { params: Promise<{ essayId: string }> };

export async function GET(_request: Request, context: Context) {
  const { dependencies } = await createEssayWorkspaceRuntime();
  return createEssayGetHandler({
    get: (essayId) => getEssayWorkspace(essayId, dependencies),
  })((await context.params).essayId);
}

export async function DELETE(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createEssayDeleteHandler({
    appUrl: config.appUrl,
    delete: (essayId) => deleteEssayWorkspace(essayId, dependencies),
  })(request, (await context.params).essayId);
}

export async function PATCH(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createEssayPatchHandler({
    appUrl: config.appUrl,
    update: (essayId, revision, patch) => {
      if (patch.outline !== undefined) {
        if (patch.draftText === undefined && patch.status === undefined) {
          return saveEssayOutline(
            essayId,
            revision,
            patch.outline,
            dependencies,
          );
        }
      }
      return saveEssayDraft(
        essayId,
        revision,
        {
          draftText: patch.draftText,
          outline: patch.outline,
          status: patch.status,
        },
        dependencies,
      );
    },
  })(request, (await context.params).essayId);
}
