import type { CookieMethodsServer } from "@supabase/ssr";
import { z } from "zod";

import {
  createSupabasePublicClient,
  createSupabaseSecretClient,
  createSupabaseSessionClient,
} from "@/adapters/supabase/client";
import { userIdSchema } from "@/contracts/domain/ids";
import { magicLinkRequestSchema } from "@/contracts/http/v1/auth";
import type { ServerConfig } from "@/lib/config/server";
import { createEmailHmac } from "@/lib/security/hmac";
import type { CompleteMagicLinkDependencies } from "@/services/auth/complete-magic-link";
import {
  EligibilityError,
  type AuthenticatedSession,
} from "@/services/auth/eligibility";
import type {
  MagicLinkRateLimit,
  RequestMagicLinkDependencies,
} from "@/services/auth/request-magic-link";

const EMAIL_DAILY_LIMIT = 5;
const IP_DAILY_LIMIT = 20;

const limitRowSchema = z.object({
  allowed: z.boolean(),
  limit_value: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  reset_at: z.iso.datetime({ offset: true }),
});

const authIdentitySchema = z.object({
  email: z.email().max(254),
  id: userIdSchema,
});

export function createSupabaseMagicLinkDependencies(
  config: ServerConfig,
): RequestMagicLinkDependencies {
  const publicClient = createSupabasePublicClient(config);
  const secretClient = createSupabaseSecretClient(config);

  async function consume(
    scope: "EMAIL" | "IP",
    keyHmac: string,
    limit: number,
  ) {
    const { data, error } = await secretClient
      .schema("private")
      .rpc("consume_auth_request_limit", {
        requested_key_hmac: keyHmac,
        requested_limit: limit,
        requested_scope: scope,
      });
    if (error) throw error;
    const row = limitRowSchema.parse(data?.[0]);
    return {
      allowed: row.allowed,
      limit: row.limit_value,
      remaining: row.remaining,
      resetAt: new Date(row.reset_at),
    };
  }

  const rateLimit: MagicLinkRateLimit = {
    consumeEmail: (key) => consume("EMAIL", key, EMAIL_DAILY_LIMIT),
    consumeIp: (key) => consume("IP", key, IP_DAILY_LIMIT),
  };

  return {
    invitations: {
      async permitsSignup(email, inviteToken) {
        if (!inviteToken) return false;
        const { data, error } = await secretClient
          .schema("private")
          .from("beta_invitations")
          .select("id")
          .eq("normalized_email_hmac", email)
          .eq("invite_token_hmac", inviteToken)
          .eq("status", "PENDING")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (error) throw error;
        return data !== null;
      },
    },
    rateLimit,
    sender: {
      async send({ email, redirectTo, shouldCreateUser }) {
        const { error } = await publicClient.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo, shouldCreateUser },
        });
        if (error) throw error;
      },
    },
  };
}

export function createSupabaseCompleteMagicLinkDependencies(
  config: ServerConfig,
  cookies: CookieMethodsServer,
): CompleteMagicLinkDependencies {
  const sessionClient = createSupabaseSessionClient(config, cookies);
  const secretClient = createSupabaseSecretClient(config);

  return {
    exchange: {
      async redeem(code) {
        const { data, error } =
          await sessionClient.auth.exchangeCodeForSession(code);
        if (error) throw error;
        const identity = authIdentitySchema.parse(data.user);
        return {
          email: magicLinkRequestSchema.parse({ email: identity.email }).email,
          userId: identity.id,
        };
      },
    },
    invitations: {
      async acceptForIdentity(identity) {
        const emailHmac = createEmailHmac(identity.email, config.hmacSecrets);
        const { error } = await secretClient
          .schema("private")
          .from("beta_invitations")
          .update({
            accepted_user_id: identity.userId,
            invite_token_hmac: null,
            status: "ACCEPTED",
          })
          .eq("normalized_email_hmac", emailHmac)
          .eq("status", "PENDING")
          .gt("expires_at", new Date().toISOString());
        if (error) throw error;
      },
    },
  };
}

export function createSupabaseAuthenticatedSession(
  config: ServerConfig,
  cookies: CookieMethodsServer,
): AuthenticatedSession & { revokeAll(): Promise<void> } {
  const client = createSupabaseSessionClient(config, cookies);
  const secretClient = createSupabaseSecretClient(config);
  return {
    async requireUserId() {
      const { data, error } = await client.auth.getClaims();
      if (error) {
        throw new EligibilityError(
          error.name === "AuthSessionMissingError"
            ? "AUTH_REQUIRED"
            : "SESSION_EXPIRED",
        );
      }
      const userId = userIdSchema.safeParse(data?.claims?.sub);
      if (!userId.success) {
        throw new EligibilityError(
          data?.claims ? "SESSION_EXPIRED" : "AUTH_REQUIRED",
        );
      }
      const { data: deletion, error: deletionError } = await secretClient
        .schema("private")
        .from("account_deletions")
        .select("id")
        .eq("user_id", userId.data)
        .limit(1)
        .maybeSingle();
      if (deletionError) throw deletionError;
      if (deletion) throw new EligibilityError("SESSION_EXPIRED");
      return userId.data;
    },
    async revokeAll() {
      const { error } = await client.auth.signOut({ scope: "global" });
      if (error) throw error;
    },
  };
}
