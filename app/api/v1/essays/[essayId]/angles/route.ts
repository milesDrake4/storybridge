import {
  createAnglesGetHandler,
  createAnglesPostHandler,
} from "@/app/api/v1/essays/angles-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { generateEssayAngles } from "@/services/strategy/generate-angles";
import { listEssayAngles } from "@/services/strategy/select-angle";

type Context = { params: Promise<{ essayId: string }> };

export async function GET(_request: Request, context: Context) {
  const { dependencies } = await createEssayWorkspaceRuntime();
  return createAnglesGetHandler({
    list: (essayId) => listEssayAngles(essayId, dependencies),
  })((await context.params).essayId);
}

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createAnglesPostHandler({
    appUrl: config.appUrl,
    generate: (essayId, input, metadata) =>
      generateEssayAngles(essayId, input, metadata, dependencies),
  })(request, (await context.params).essayId);
}
