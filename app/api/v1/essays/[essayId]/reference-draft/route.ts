import { createReferenceDraftPostHandler } from "@/app/api/v1/essays/reference-draft-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { generateReferenceDraft } from "@/services/fallback/generate-reference";

type Context = { params: Promise<{ essayId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  return createReferenceDraftPostHandler({
    appUrl: config.appUrl,
    generate: (essayId, input, metadata) =>
      generateReferenceDraft(essayId, input, metadata, dependencies),
  })(request, (await context.params).essayId);
}
