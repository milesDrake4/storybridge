import { createBillingEntitlementGetHandler } from "@/app/api/v1/billing/entitlement/handler";
import { createBillingEntitlementRuntime } from "@/app/api/v1/billing/entitlement/runtime";
import { getBillingEntitlement } from "@/services/essays/essay-allowance";

export async function GET(request: Request): Promise<Response> {
  const dependencies = await createBillingEntitlementRuntime();
  return createBillingEntitlementGetHandler({
    get: () => getBillingEntitlement(dependencies),
  })(request);
}
