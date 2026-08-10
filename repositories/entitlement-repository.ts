import type { UserId } from "@/contracts/domain/ids";
import type { BillingEntitlement } from "@/contracts/http/v1/billing";
import type { ApplicationSeason } from "@/contracts/http/v1/essays";

export interface EntitlementRepository {
  getCurrent(input: {
    at: Date;
    season: ApplicationSeason;
    userId: UserId;
  }): Promise<BillingEntitlement>;
}
