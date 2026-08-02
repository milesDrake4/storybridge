import { createHmac } from "node:crypto";

import type { HmacSecrets } from "@/lib/config/server";

const ACTIVE_HMAC_KEY_VERSION = "v1";

type PurposeHmac<Purpose extends string> = string & {
  readonly __hmacPurpose: Purpose;
};

export type IpHmac = PurposeHmac<"IP">;
export type EmailHmac = PurposeHmac<"EMAIL">;
export type InvitationTokenHmac = PurposeHmac<"INVITATION_TOKEN">;
export type ContentHmac = PurposeHmac<"CONTENT">;
export type IdempotencyHmac = PurposeHmac<"IDEMPOTENCY">;

function createPurposeHmac<Purpose extends string>(
  purpose: Purpose,
  value: string,
  secret: string,
): PurposeHmac<Purpose> {
  const digest = createHmac("sha256", secret)
    .update(`storybridge:${purpose}:${value}`, "utf8")
    .digest("base64url");
  return `${ACTIVE_HMAC_KEY_VERSION}.${digest}` as PurposeHmac<Purpose>;
}

export function createIpHmac(
  value: string,
  secrets: HmacSecrets,
  now = new Date(),
): IpHmac {
  const utcDay = now.toISOString().slice(0, 10);
  return createPurposeHmac("IP", `${utcDay}:${value}`, secrets.ip);
}

export function createInvitationTokenHmac(
  value: string,
  secrets: HmacSecrets,
): InvitationTokenHmac {
  return createPurposeHmac("INVITATION_TOKEN", value, secrets.idempotency);
}

export function createEmailHmac(
  value: string,
  secrets: HmacSecrets,
): EmailHmac {
  return createPurposeHmac("EMAIL", value, secrets.idempotency);
}

export function createContentHmac(
  value: string,
  secrets: HmacSecrets,
): ContentHmac {
  return createPurposeHmac("CONTENT", value, secrets.content);
}

export function createIdempotencyHmac(
  value: string,
  secrets: HmacSecrets,
): IdempotencyHmac {
  return createPurposeHmac("IDEMPOTENCY", value, secrets.idempotency);
}
