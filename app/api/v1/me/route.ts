import { createDeleteAccountHandler } from "@/app/api/v1/me/handler";
import { createAccountPrivacyRuntime } from "@/app/api/v1/me/runtime";
import { requestAccountDeletion } from "@/services/privacy/delete-account";

export async function DELETE(request: Request): Promise<Response> {
  const { config, dependencies } = await createAccountPrivacyRuntime();
  return createDeleteAccountHandler({
    appUrl: config.appUrl,
    deleteAccount: (idempotencyKey) =>
      requestAccountDeletion(dependencies, idempotencyKey),
  })(request);
}
