import { storyFactIdSchema, type StoryFactId } from "@/contracts/domain/ids";
import {
  storyFactPatchSchema,
  storyFactSuppressionInputSchema,
  storyFactVerificationInputSchema,
  storyProfilePatchSchema,
  type StoryFact,
  type StoryFactPatch,
  type StoryFactVerificationInput,
  type StoryProfile,
  type StoryProfilePatch,
  type StoryProfileWithFacts,
} from "@/contracts/domain/story-vault";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  requireProfileRevision,
  requireRevision,
  revisionEtag,
  RevisionHeaderError,
} from "@/lib/http/revision-etag";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { StoryVaultError } from "@/services/story-vault/manage-facts";

type Common = { appUrl: URL };

function safeError(error: unknown): Response {
  if (
    error instanceof RequestBoundaryError ||
    error instanceof RevisionHeaderError
  ) {
    return createErrorResponse(error.code);
  }
  if (error instanceof EligibilityError || error instanceof StoryVaultError) {
    return createErrorResponse(error.code);
  }
  return createErrorResponse("INTERNAL_ERROR");
}

function factId(raw: string): StoryFactId {
  const parsed = storyFactIdSchema.safeParse(raw);
  if (!parsed.success) throw new StoryVaultError("RESOURCE_NOT_FOUND");
  return parsed.data;
}

function factResponse(fact: StoryFact): Response {
  return createSuccessResponse(fact, {
    headers: {
      etag: revisionEtag({ id: fact.id, kind: "fact" }, fact.revision),
    },
  });
}

export function createStoryProfileGetHandler(dependencies: {
  get(): Promise<StoryProfileWithFacts>;
}) {
  return async function getStoryProfile(): Promise<Response> {
    try {
      const vault = await dependencies.get();
      return createSuccessResponse(vault, {
        headers: {
          etag: revisionEtag(
            { id: vault.profile.id, kind: "profile" },
            vault.profile.revision,
          ),
        },
      });
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createStoryProfilePatchHandler(
  dependencies: Common & {
    update(
      id: ReturnType<typeof requireProfileRevision>["id"],
      revision: number,
      patch: StoryProfilePatch,
    ): Promise<StoryProfile>;
  },
) {
  return async function patchStoryProfile(request: Request): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const expected = requireProfileRevision(request);
      const patch = await readJsonBody(request, storyProfilePatchSchema);
      const profile = await dependencies.update(
        expected.id,
        expected.revision,
        patch,
      );
      return createSuccessResponse(profile, {
        headers: {
          etag: revisionEtag(
            { id: profile.id, kind: "profile" },
            profile.revision,
          ),
        },
      });
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createStoryFactPatchHandler(
  dependencies: Common & {
    update(
      id: StoryFactId,
      revision: number,
      patch: StoryFactPatch,
    ): Promise<StoryFact>;
  },
) {
  return async function patchStoryFact(request: Request, rawFactId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const id = factId(rawFactId);
      const revision = requireRevision(request, { id, kind: "fact" });
      const patch = await readJsonBody(request, storyFactPatchSchema);
      return factResponse(await dependencies.update(id, revision, patch));
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createStoryFactVerificationPostHandler(
  dependencies: Common & {
    verify(
      id: StoryFactId,
      input: StoryFactVerificationInput,
    ): Promise<StoryFact>;
  },
) {
  return async function verifyStoryFact(request: Request, rawFactId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      requireIdempotencyKey(request);
      const id = factId(rawFactId);
      const input = await readJsonBody(
        request,
        storyFactVerificationInputSchema,
      );
      const revision = requireRevision(request, { id, kind: "fact" });
      if (revision !== input.expectedRevision) {
        throw new RevisionHeaderError("REVISION_MISMATCH");
      }
      return factResponse(await dependencies.verify(id, input));
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createStoryFactSuppressionPutHandler(
  dependencies: Common & {
    suppress(id: StoryFactId, suppressed: boolean): Promise<StoryFact>;
  },
) {
  return async function suppressStoryFact(request: Request, rawFactId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      requireIdempotencyKey(request);
      const id = factId(rawFactId);
      const input = await readJsonBody(
        request,
        storyFactSuppressionInputSchema,
      );
      return factResponse(await dependencies.suppress(id, input.suppressed));
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createStoryFactDeleteHandler(
  dependencies: Common & { delete(id: StoryFactId): Promise<void> },
) {
  return async function deleteStoryFact(request: Request, rawFactId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      requireIdempotencyKey(request);
      await dependencies.delete(factId(rawFactId));
      return new Response(null, {
        headers: { "cache-control": "private, no-store" },
        status: 204,
      });
    } catch (error) {
      return safeError(error);
    }
  };
}
