import {
  createEssayDeleteHandler,
  createEssayGetHandler,
} from "@/app/api/v1/essays/handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import {
  deleteEssayWorkspace,
  getEssayWorkspace,
} from "@/services/essays/manage-workspaces";

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
