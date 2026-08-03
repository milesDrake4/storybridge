import {
  createStoryFactDeleteHandler,
  createStoryFactPatchHandler,
} from "@/app/api/v1/story-vault/handler";
import { createStoryVaultRuntime } from "@/app/api/v1/story-vault/runtime";
import {
  deleteStoryFact,
  updateStoryFact,
} from "@/services/story-vault/manage-facts";

type Context = { params: Promise<{ factId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { config, dependencies } = await createStoryVaultRuntime();
  return createStoryFactPatchHandler({
    appUrl: config.appUrl,
    update: (id, revision, patch) =>
      updateStoryFact(id, revision, patch, dependencies),
  })(request, (await context.params).factId);
}

export async function DELETE(request: Request, context: Context) {
  const { config, dependencies } = await createStoryVaultRuntime();
  return createStoryFactDeleteHandler({
    appUrl: config.appUrl,
    delete: (id) => deleteStoryFact(id, dependencies),
  })(request, (await context.params).factId);
}
