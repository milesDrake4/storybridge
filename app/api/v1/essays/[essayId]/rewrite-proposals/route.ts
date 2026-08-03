import { createRewriteProposalPostHandler } from "@/app/api/v1/essays/revision-proposal-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { proposeRewrite } from "@/services/coaching/propose-rewrite";

type Context = { params: Promise<{ essayId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createRewriteProposalPostHandler({
    appUrl: config.appUrl,
    propose: (essayId, input, metadata) =>
      proposeRewrite(essayId, input, metadata, dependencies),
  })(request, (await context.params).essayId);
}
