import { createClaimConfirmationPutHandler } from "@/app/api/v1/essays/claim-confirmation-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { decideReferenceClaim } from "@/services/fallback/decide-claim";

type Context = {
  params: Promise<{ claimId: string; essayId: string }>;
};

export async function PUT(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  const { claimId, essayId } = await context.params;
  return createClaimConfirmationPutHandler({
    appUrl: config.appUrl,
    decide: (essayId, claimId, input, metadata) =>
      decideReferenceClaim(essayId, claimId, input, metadata, dependencies),
  })(request, essayId, claimId);
}
