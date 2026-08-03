import { createCoachProposalPostHandler } from "@/app/api/v1/essays/coach-proposal-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { proposeAdvice } from "@/services/coaching/propose-advice";

type Context = { params: Promise<{ essayId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createCoachProposalPostHandler({
    appUrl: config.appUrl,
    propose: (essayId, input, metadata) =>
      proposeAdvice(essayId, input, metadata, dependencies),
  })(request, (await context.params).essayId);
}
