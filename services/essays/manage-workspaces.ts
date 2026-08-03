import { z } from "zod";

import {
  essayIdSchema,
  userIdSchema,
  type EssayId,
} from "@/contracts/domain/ids";
import type { Page } from "@/contracts/http/v1/common";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import {
  applicationSeasonSchema,
  type CreateEssayInput,
  type EssayListQuery,
  type EssaySummary,
  type EssayWorkspace,
} from "@/contracts/http/v1/essays";
import type { HmacSecrets } from "@/lib/config/server";
import { signCursor, verifyCursor } from "@/lib/http/signed-cursor";
import { createContentHmac, createIdempotencyHmac } from "@/lib/security/hmac";
import { normalizePlainText } from "@/lib/security/request-boundary";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";
import { hasPromptPrivacyRisk } from "@/services/essays/prompt-privacy";

const CURRENT_APPLICATION_SEASON = applicationSeasonSchema.value;
const CURSOR_TTL_MS = 15 * 60_000;

const cursorSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  id: essayIdSchema,
  scope: z.literal("essays"),
  updatedAt: z.iso.datetime({ offset: true }),
  userId: userIdSchema,
  version: z.literal(1),
});

type EssayWorkspaceErrorCode = Extract<
  ErrorCode,
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_QUERY"
  | "INVITATION_REQUIRED"
  | "PROMPT_PRIVACY_RISK"
  | "QUOTA_EXCEEDED"
  | "RESOURCE_NOT_FOUND"
  | "UNSUPPORTED_SCHOOL"
>;

export class EssayWorkspaceError extends Error {
  readonly code: EssayWorkspaceErrorCode;

  constructor(code: EssayWorkspaceErrorCode) {
    super(code);
    this.name = "EssayWorkspaceError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  cursorSecret: string;
  essays: EssayWorkspaceRepository;
  hmacSecrets: HmacSecrets;
};

function summary(workspace: EssayWorkspace): EssaySummary {
  return {
    createdAt: workspace.essay.createdAt,
    id: workspace.essay.id,
    school: workspace.school,
    status: workspace.essay.status,
    updatedAt: workspace.essay.updatedAt,
    wordLimit: workspace.essay.wordLimit,
  };
}

export async function listEssayWorkspaces(
  input: EssayListQuery,
  dependencies: Dependencies,
  now = new Date(),
): Promise<Page<EssaySummary>> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const after = input.cursor
    ? verifyCursor(input.cursor, cursorSchema, dependencies.cursorSecret)
    : null;
  if (
    input.cursor &&
    (!after || after.userId !== userId || after.expiresAt <= now.getTime())
  ) {
    throw new EssayWorkspaceError("INVALID_QUERY");
  }

  const rows = await dependencies.essays.list({
    after: after ? { id: after.id, updatedAt: after.updatedAt } : null,
    limit: input.limit + 1,
    userId,
  });
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > input.limit && last
      ? signCursor(
          {
            expiresAt: now.getTime() + CURSOR_TTL_MS,
            id: last.essay.id,
            scope: "essays",
            updatedAt: last.essay.updatedAt,
            userId,
            version: 1,
          },
          dependencies.cursorSecret,
        )
      : null;
  return { items: items.map(summary), nextCursor };
}

export async function createEssayWorkspace(
  input: CreateEssayInput,
  request: { idempotencyKey: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<EssayWorkspace> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const normalized = {
    prompt: normalizePlainText(input.prompt).trim(),
    schoolId: input.schoolId,
    season: CURRENT_APPLICATION_SEASON,
    wordLimit: input.wordLimit,
  };
  if (hasPromptPrivacyRisk(normalized.prompt)) {
    throw new EssayWorkspaceError("PROMPT_PRIVACY_RISK");
  }

  const result = await dependencies.essays.create({
    ...normalized,
    idempotencyKeyHmac: createIdempotencyHmac(
      `${userId}:POST:/api/v1/essays:${request.idempotencyKey}`,
      dependencies.hmacSecrets,
    ),
    now,
    requestHmac: createContentHmac(
      JSON.stringify(normalized),
      dependencies.hmacSecrets,
    ),
    userId,
  });

  if (result.type === "CREATED" || result.type === "REPLAY") {
    return result.value;
  }
  const codeByDecision = {
    IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
    NOT_ELIGIBLE: "INVITATION_REQUIRED",
    QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
    REPLAY_DELETED: "RESOURCE_NOT_FOUND",
    UNSUPPORTED_SCHOOL: "UNSUPPORTED_SCHOOL",
  } as const;
  throw new EssayWorkspaceError(codeByDecision[result.type]);
}

export async function getEssayWorkspace(
  essayId: EssayId,
  dependencies: Dependencies,
  now = new Date(),
): Promise<EssayWorkspace> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace) throw new EssayWorkspaceError("RESOURCE_NOT_FOUND");
  return workspace;
}

export async function deleteEssayWorkspace(
  essayId: EssayId,
  dependencies: Dependencies,
  now = new Date(),
): Promise<void> {
  const { userId } = await requireProductEligibility(dependencies, now);
  await dependencies.essays.delete(userId, essayId);
}
