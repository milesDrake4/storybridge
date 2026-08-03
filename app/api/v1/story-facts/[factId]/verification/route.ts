import { createStoryFactVerificationPostHandler } from "@/app/api/v1/story-vault/handler";
import { createStoryVaultRuntime } from "@/app/api/v1/story-vault/runtime";
import { verifyStoryFact } from "@/services/story-vault/manage-facts";

type Context = { params: Promise<{ factId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createStoryVaultRuntime();
  return createStoryFactVerificationPostHandler({
    appUrl: config.appUrl,
    verify: (id, input) => verifyStoryFact(id, input, dependencies),
  })(request, (await context.params).factId);
}
