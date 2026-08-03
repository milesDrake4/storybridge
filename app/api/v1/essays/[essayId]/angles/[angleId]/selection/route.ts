import { createAngleSelectionPostHandler } from "@/app/api/v1/essays/angle-selection-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { selectEssayAngle } from "@/services/strategy/select-angle";

type Context = { params: Promise<{ angleId: string; essayId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  const params = await context.params;
  return createAngleSelectionPostHandler({
    appUrl: config.appUrl,
    select: (essayId, angleId) =>
      selectEssayAngle(essayId, angleId, dependencies),
  })(request, params.essayId, params.angleId);
}
