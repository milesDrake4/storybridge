import type { z } from "zod";

import type { ErrorCode, ErrorHttpStatus } from "@/contracts/http/v1/errors";
import {
  errorStatusByCode,
  publicErrorMessageByCode,
} from "@/contracts/http/v1/errors";

const DEFAULT_MAX_JSON_BYTES = 64 * 1_024;

export class RequestBoundaryError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorHttpStatus;

  constructor(code: ErrorCode) {
    super(publicErrorMessageByCode[code]);
    this.name = "RequestBoundaryError";
    this.code = code;
    this.status = errorStatusByCode[code];
  }
}

export function normalizePlainText(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n");

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
        (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      throw new RequestBoundaryError("VALIDATION_ERROR");
    }
  }

  return normalized;
}

export function assertSameOriginMutation(request: Request, appUrl: URL): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    origin !== appUrl.origin ||
    host !== appUrl.host ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    throw new RequestBoundaryError("VALIDATION_ERROR");
  }
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      throw new RequestBoundaryError("VALIDATION_ERROR");
    }
  }

  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RequestBoundaryError("VALIDATION_ERROR");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<z.output<Schema>> {
  const contentType = request.headers.get("content-type");
  if (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    throw new RequestBoundaryError("INVALID_CONTENT_TYPE");
  }

  const bytes = await readBoundedBody(request, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestBoundaryError("MALFORMED_JSON");
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RequestBoundaryError("VALIDATION_ERROR");
  }
  return parsed.data;
}
