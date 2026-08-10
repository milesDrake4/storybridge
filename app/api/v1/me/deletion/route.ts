import { createAccountDeletionStatusHandler } from "@/app/api/v1/me/handler";
import { createDeletionStatusRuntime } from "@/app/api/v1/me/runtime";
import { getAccountDeletionStatus } from "@/services/privacy/delete-account";

export async function GET(request: Request): Promise<Response> {
  const dependencies = createDeletionStatusRuntime();
  return createAccountDeletionStatusHandler({
    getStatus: (statusToken) =>
      getAccountDeletionStatus(statusToken, dependencies),
  })(request);
}
