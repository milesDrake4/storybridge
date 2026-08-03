import { createContinuationProposalPostHandler } from "@/app/api/v1/essays/revision-proposal-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { proposeContinuation } from "@/services/coaching/propose-continuation";

type Context = { params: Promise<{ essayId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createContinuationProposalPostHandler({
    appUrl: config.appUrl,
    propose: (essayId, input, metadata) =>
      proposeContinuation(essayId, input, metadata, dependencies),
  })(request, (await context.params).essayId);
}
