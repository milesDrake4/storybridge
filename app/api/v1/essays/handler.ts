import type { z } from "zod";

import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import type { Page } from "@/contracts/http/v1/common";
import {
  createEssayInputSchema,
  essayOutlinePatchSchema,
  essayListQuerySchema,
  type CreateEssayInput,
  type Essay,
  type EssaySummary,
  type EssayWorkspace,
} from "@/contracts/http/v1/essays";
import type { OutlineV1 } from "@/contracts/http/v1/outlines";
import {
  requireRevision,
  revisionEtag,
  RevisionHeaderError,
} from "@/lib/http/revision-etag";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { EssayWorkspaceError } from "@/services/essays/manage-workspaces";
import { SaveOutlineError } from "@/services/essays/save-outline";

function safeError(error: unknown): Response {
  if (
    error instanceof RequestBoundaryError ||
    error instanceof EligibilityError ||
    error instanceof EssayWorkspaceError ||
    error instanceof RevisionHeaderError ||
    error instanceof SaveOutlineError
  ) {
    return createErrorResponse(error.code);
  }
  return createErrorResponse("INTERNAL_ERROR");
}

export function createEssayPatchHandler(dependencies: {
  appUrl: URL;
  update(
    essayId: EssayId,
    revision: number,
    outline: OutlineV1,
  ): Promise<Essay>;
}) {
  return async function patchEssay(
    request: Request,
    rawEssayId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const id = parseEssayId(rawEssayId);
      const revision = requireRevision(request, { id, kind: "essay" });
      const patch = await readJsonBody(request, essayOutlinePatchSchema);
      const essay = await dependencies.update(id, revision, patch.outline);
      return createSuccessResponse(essay, {
        headers: {
          etag: revisionEtag({ id: essay.id, kind: "essay" }, essay.revision),
        },
      });
    } catch (error) {
      return safeError(error);
    }
  };
}

function parseQuery(url: URL): z.output<typeof essayListQuerySchema> {
  const allowed = new Set(["cursor", "limit"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new EssayWorkspaceError("INVALID_QUERY");
    }
  }
  const parsed = essayListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) throw new EssayWorkspaceError("INVALID_QUERY");
  return parsed.data;
}

function parseEssayId(raw: string): EssayId {
  const parsed = essayIdSchema.safeParse(raw);
  if (!parsed.success) throw new EssayWorkspaceError("RESOURCE_NOT_FOUND");
  return parsed.data;
}

function workspaceResponse(workspace: EssayWorkspace, status: 200 | 201 = 200) {
  return createSuccessResponse(workspace, {
    headers: {
      etag: revisionEtag(
        { id: workspace.essay.id, kind: "essay" },
        workspace.essay.revision,
      ),
    },
    status,
  });
}

export function createEssaysGetHandler(dependencies: {
  list(
    input: z.output<typeof essayListQuerySchema>,
  ): Promise<Page<EssaySummary>>;
}) {
  return async function getEssays(request: Request): Promise<Response> {
    try {
      return createSuccessResponse(
        await dependencies.list(parseQuery(new URL(request.url))),
      );
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createEssayPostHandler(dependencies: {
  appUrl: URL;
  create(
    input: CreateEssayInput,
    request: { idempotencyKey: string },
  ): Promise<EssayWorkspace>;
}) {
  return async function postEssay(request: Request): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(request, createEssayInputSchema);
      return workspaceResponse(
        await dependencies.create(input, { idempotencyKey }),
        201,
      );
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createEssayGetHandler(dependencies: {
  get(essayId: EssayId): Promise<EssayWorkspace>;
}) {
  return async function getEssay(rawEssayId: string): Promise<Response> {
    try {
      return workspaceResponse(
        await dependencies.get(parseEssayId(rawEssayId)),
      );
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createEssayDeleteHandler(dependencies: {
  appUrl: URL;
  delete(essayId: EssayId): Promise<void>;
}) {
  return async function deleteEssay(
    request: Request,
    rawEssayId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      requireIdempotencyKey(request);
      await dependencies.delete(parseEssayId(rawEssayId));
      return new Response(null, {
        headers: { "cache-control": "private, no-store" },
        status: 204,
      });
    } catch (error) {
      return safeError(error);
    }
  };
}
