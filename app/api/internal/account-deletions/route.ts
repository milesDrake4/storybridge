import {
  createSupabaseAccountDeletionRepository,
  createSupabaseAccountIdentityProvider,
} from "@/adapters/supabase/account-deletion-repository";
import { createAccountDeletionWorkerHandler } from "@/app/api/internal/account-deletions/handler";
import { parseServerConfig } from "@/lib/config/server";
import { processNextAccountDeletion } from "@/services/privacy/process-account-deletion";

export async function POST(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  const dependencies = {
    deletions: createSupabaseAccountDeletionRepository(config),
    provider: createSupabaseAccountIdentityProvider(config),
  };
  return createAccountDeletionWorkerHandler({
    processNext: () => processNextAccountDeletion(dependencies),
    secret: config.internalOperationsSecret,
  })(request);
}
