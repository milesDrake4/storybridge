import { applicationSeasonSchema } from "@/contracts/http/v1/essays";
import type { EntitlementRepository } from "@/repositories/entitlement-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type Dependencies = EligibilityDependencies & {
  entitlements: EntitlementRepository;
};

export async function getBillingEntitlement(
  dependencies: Dependencies,
  now = new Date(),
) {
  const { userId } = await requireProductEligibility(dependencies, now);
  return dependencies.entitlements.getCurrent({
    at: now,
    season: applicationSeasonSchema.value,
    userId,
  });
}
