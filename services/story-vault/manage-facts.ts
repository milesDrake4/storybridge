import type { StoryFactId, StoryProfileId } from "@/contracts/domain/ids";
import type {
  StoryFact,
  StoryFactPatch,
  StoryFactVerificationInput,
  StoryProfile,
  StoryProfilePatch,
  StoryProfileWithFacts,
} from "@/contracts/domain/story-vault";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { HmacSecrets } from "@/lib/config/server";
import { createContentHmac } from "@/lib/security/hmac";
import type { StoryVaultRepository } from "@/repositories/story-vault-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

export class StoryVaultError extends Error {
  readonly code: Extract<ErrorCode, "RESOURCE_NOT_FOUND" | "REVISION_MISMATCH">;

  constructor(code: StoryVaultError["code"]) {
    super(code);
    this.name = "StoryVaultError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  hmacSecrets: HmacSecrets;
  vault: StoryVaultRepository;
};

function resultValue<Value>(result: {
  type: "NOT_FOUND" | "REPLAY" | "REVISION_MISMATCH" | "UPDATED";
  value?: Value;
}): Value {
  if (result.type === "NOT_FOUND")
    throw new StoryVaultError("RESOURCE_NOT_FOUND");
  if (result.type === "REVISION_MISMATCH") {
    throw new StoryVaultError("REVISION_MISMATCH");
  }
  if (!result.value) throw new StoryVaultError("RESOURCE_NOT_FOUND");
  return result.value;
}

export async function getStoryVault(
  dependencies: Dependencies,
  now = new Date(),
): Promise<StoryProfileWithFacts> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const vault = await dependencies.vault.getCurrent(userId);
  if (!vault) throw new StoryVaultError("RESOURCE_NOT_FOUND");
  return vault;
}

export async function updateStoryProfile(
  profileId: StoryProfileId,
  expectedRevision: number,
  patch: StoryProfilePatch,
  dependencies: Dependencies,
  now = new Date(),
): Promise<StoryProfile> {
  const { userId } = await requireProductEligibility(dependencies, now);
  return resultValue(
    await dependencies.vault.updateProfile({
      expectedRevision,
      now,
      patch,
      profileId,
      userId,
    }),
  );
}

export async function updateStoryFact(
  factId: StoryFactId,
  expectedRevision: number,
  patch: StoryFactPatch,
  dependencies: Dependencies,
  now = new Date(),
): Promise<StoryFact> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const current = await dependencies.vault.getCurrent(userId);
  const fact = current?.facts.find((candidate) => candidate.id === factId);
  if (!fact) throw new StoryVaultError("RESOURCE_NOT_FOUND");
  const contentHmac = createContentHmac(
    JSON.stringify({
      category: fact.category,
      details: patch.details,
      sourceMessageIds: fact.sourceMessageIds,
      summary: patch.summary,
    }),
    dependencies.hmacSecrets,
  );
  return resultValue(
    await dependencies.vault.updateFact({
      contentHmac,
      expectedRevision,
      factId,
      now,
      patch,
      userId,
    }),
  );
}

export async function verifyStoryFact(
  factId: StoryFactId,
  input: StoryFactVerificationInput,
  dependencies: Dependencies,
  now = new Date(),
): Promise<StoryFact> {
  const { userId } = await requireProductEligibility(dependencies, now);
  return resultValue(
    await dependencies.vault.verifyFact({
      contentHmac: input.contentHash,
      decision: input.decision,
      expectedRevision: input.expectedRevision,
      factId,
      now,
      userId,
    }),
  );
}

export async function suppressStoryFact(
  factId: StoryFactId,
  suppressed: boolean,
  dependencies: Dependencies,
  now = new Date(),
): Promise<StoryFact> {
  const { userId } = await requireProductEligibility(dependencies, now);
  return resultValue(
    await dependencies.vault.suppressFact({ factId, now, suppressed, userId }),
  );
}

export async function deleteStoryFact(
  factId: StoryFactId,
  dependencies: Dependencies,
  now = new Date(),
): Promise<void> {
  const { userId } = await requireProductEligibility(dependencies, now);
  await dependencies.vault.deleteFact(userId, factId);
}
