import type {
  MagicLinkAccepted,
  MagicLinkRequest,
} from "@/contracts/http/v1/auth";
import type { EmailHmac, IpHmac } from "@/lib/security/hmac";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
};

export type MagicLinkRateLimit = {
  consumeEmail(key: EmailHmac): Promise<RateLimitDecision>;
  consumeIp(key: IpHmac): Promise<RateLimitDecision>;
};

export type MagicLinkInvitationLookup = {
  permitsSignup(email: EmailHmac, inviteToken?: string): Promise<boolean>;
};

export type MagicLinkSender = {
  send(input: {
    email: string;
    redirectTo: string;
    shouldCreateUser: boolean;
  }): Promise<void>;
};

export type RequestMagicLinkDependencies = {
  invitations: MagicLinkInvitationLookup;
  rateLimit: MagicLinkRateLimit;
  sender: MagicLinkSender;
};

export type RequestMagicLinkResult =
  | { type: "ACCEPTED"; value: MagicLinkAccepted }
  | { type: "RATE_LIMITED"; decision: RateLimitDecision };

export async function requestMagicLink(
  input: MagicLinkRequest & {
    emailHmac: EmailHmac;
    ipHmac: IpHmac;
    redirectTo: string;
  },
  dependencies: RequestMagicLinkDependencies,
): Promise<RequestMagicLinkResult> {
  const [emailLimit, ipLimit] = await Promise.all([
    dependencies.rateLimit.consumeEmail(input.emailHmac),
    dependencies.rateLimit.consumeIp(input.ipHmac),
  ]);

  if (!emailLimit.allowed) {
    return { type: "RATE_LIMITED", decision: emailLimit };
  }
  if (!ipLimit.allowed) {
    return { type: "RATE_LIMITED", decision: ipLimit };
  }

  const shouldCreateUser = await dependencies.invitations.permitsSignup(
    input.emailHmac,
    input.inviteToken,
  );

  try {
    await dependencies.sender.send({
      email: input.email,
      redirectTo: input.redirectTo,
      shouldCreateUser,
    });
  } catch {
    // Public auth requests deliberately conceal account and provider state.
  }

  return { type: "ACCEPTED", value: { accepted: true } };
}
