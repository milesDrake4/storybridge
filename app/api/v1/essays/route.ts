import {
  createEssayPostHandler,
  createEssaysGetHandler,
} from "@/app/api/v1/essays/handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import {
  createEssayWorkspace,
  listEssayWorkspaces,
} from "@/services/essays/manage-workspaces";

export async function GET(request: Request): Promise<Response> {
  const { dependencies } = await createEssayWorkspaceRuntime();
  return createEssaysGetHandler({
    list: (input) => listEssayWorkspaces(input, dependencies),
  })(request);
}

export async function POST(request: Request): Promise<Response> {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createEssayPostHandler({
    appUrl: config.appUrl,
    create: (input, requestMetadata) =>
      createEssayWorkspace(input, requestMetadata, dependencies),
  })(request);
}
