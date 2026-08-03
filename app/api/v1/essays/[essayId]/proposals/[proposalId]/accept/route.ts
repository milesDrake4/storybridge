import { createProposalAcceptancePostHandler } from "@/app/api/v1/essays/proposal-acceptance-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { acceptProposal } from "@/services/coaching/accept-proposal";

type Context = {
  params: Promise<{ essayId: string; proposalId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  const params = await context.params;
  return createProposalAcceptancePostHandler({
    accept: (essayId, proposalId, input, metadata) =>
      acceptProposal(
        essayId,
        proposalId,
        input.expectedRevision,
        metadata,
        dependencies,
      ),
    appUrl: config.appUrl,
  })(request, params.essayId, params.proposalId);
}
