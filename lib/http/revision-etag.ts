import {
  storyProfileIdSchema,
  type StoryFactId,
  type StoryProfileId,
} from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";

export class RevisionHeaderError extends Error {
  readonly code: Extract<ErrorCode, "REVISION_MISMATCH" | "REVISION_REQUIRED">;

  constructor(code: RevisionHeaderError["code"]) {
    super(code);
    this.name = "RevisionHeaderError";
    this.code = code;
  }
}

type RevisionResource =
  | { id: StoryFactId; kind: "fact" }
  | { id: StoryProfileId; kind: "profile" };

export function revisionEtag(
  resource: RevisionResource,
  revision: number,
): string {
  return `"${resource.kind}:${resource.id}:r${revision}"`;
}

export function requireRevision(
  request: Request,
  resource: RevisionResource,
): number {
  const value = request.headers.get("if-match");
  if (!value) throw new RevisionHeaderError("REVISION_REQUIRED");
  const prefix = `"${resource.kind}:${resource.id}:r`;
  if (!value.startsWith(prefix) || !value.endsWith('"')) {
    throw new RevisionHeaderError("REVISION_MISMATCH");
  }
  const raw = value.slice(prefix.length, -1);
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new RevisionHeaderError("REVISION_MISMATCH");
  }
  return Number(raw);
}

export function requireProfileRevision(request: Request): {
  id: StoryProfileId;
  revision: number;
} {
  const value = request.headers.get("if-match");
  if (!value) throw new RevisionHeaderError("REVISION_REQUIRED");
  const match = /^"profile:([0-9a-f-]+):r([1-9][0-9]*)"$/.exec(value);
  if (!match) throw new RevisionHeaderError("REVISION_MISMATCH");
  const id = storyProfileIdSchema.safeParse(match[1]);
  if (!id.success) throw new RevisionHeaderError("REVISION_MISMATCH");
  return { id: id.data, revision: Number(match[2]) };
}
