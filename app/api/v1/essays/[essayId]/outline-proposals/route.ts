import { createOutlineProposalPostHandler } from "@/app/api/v1/essays/outline-proposal-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { proposeEssayOutline } from "@/services/strategy/propose-outline";

type Context = { params: Promise<{ essayId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createOutlineProposalPostHandler({
    appUrl: config.appUrl,
    propose: (essayId, metadata) =>
      proposeEssayOutline(essayId, metadata, dependencies),
  })(request, (await context.params).essayId);
}
