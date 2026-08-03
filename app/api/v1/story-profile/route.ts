import {
  createStoryProfileGetHandler,
  createStoryProfilePatchHandler,
} from "@/app/api/v1/story-vault/handler";
import { createStoryVaultRuntime } from "@/app/api/v1/story-vault/runtime";
import {
  getStoryVault,
  updateStoryProfile,
} from "@/services/story-vault/manage-facts";

export async function GET(): Promise<Response> {
  const { dependencies } = await createStoryVaultRuntime();
  return createStoryProfileGetHandler({
    get: () => getStoryVault(dependencies),
  })();
}

export async function PATCH(request: Request): Promise<Response> {
  const { config, dependencies } = await createStoryVaultRuntime();
  return createStoryProfilePatchHandler({
    appUrl: config.appUrl,
    update: (id, revision, patch) =>
      updateStoryProfile(id, revision, patch, dependencies),
  })(request);
}
