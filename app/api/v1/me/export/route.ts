import { createAccountExportHandler } from "@/app/api/v1/me/handler";
import { createAccountPrivacyRuntime } from "@/app/api/v1/me/runtime";
import { exportAccountData } from "@/services/privacy/export-account";

export async function GET(): Promise<Response> {
  const { dependencies } = await createAccountPrivacyRuntime();
  return createAccountExportHandler({
    exportAccount: () => exportAccountData(dependencies),
  })();
}
