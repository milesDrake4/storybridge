import { createStoryFactSuppressionPutHandler } from "@/app/api/v1/story-vault/handler";
import { createStoryVaultRuntime } from "@/app/api/v1/story-vault/runtime";
import { suppressStoryFact } from "@/services/story-vault/manage-facts";

type Context = { params: Promise<{ factId: string }> };

export async function PUT(request: Request, context: Context) {
  const { config, dependencies } = await createStoryVaultRuntime();
  return createStoryFactSuppressionPutHandler({
    appUrl: config.appUrl,
    suppress: (id, suppressed) =>
      suppressStoryFact(id, suppressed, dependencies),
  })(request, (await context.params).factId);
}
