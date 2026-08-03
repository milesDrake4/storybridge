import { createAnglePatchHandler } from "@/app/api/v1/essays/angle-update-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { updateEssayAngle } from "@/services/strategy/select-angle";

type Context = { params: Promise<{ angleId: string; essayId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  const params = await context.params;
  return createAnglePatchHandler({
    appUrl: config.appUrl,
    update: (essayId, angleId, revision, patch) =>
      updateEssayAngle(essayId, angleId, revision, patch, dependencies),
  })(request, params.essayId, params.angleId);
}
