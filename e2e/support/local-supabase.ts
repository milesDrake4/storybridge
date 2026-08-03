import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { CURRENT_POLICY_VERSIONS } from "../../services/auth/eligibility";

export type LocalSupabaseEnvironment = {
  publishableKey: string;
  secretKey: string;
  supabaseUrl: string;
};

const STATELESS_AUTH = {
  autoRefreshToken: false,
  detectSessionInUrl: false,
  persistSession: false,
} as const;

type SsrCookie = {
  name: string;
  options: CookieOptions;
  value: string;
};

type PlaywrightSameSite = "Lax" | "None" | "Strict";

type PlaywrightStorageState = {
  cookies: Array<{
    domain: string;
    expires: number;
    httpOnly: boolean;
    name: string;
    path: string;
    sameSite: PlaywrightSameSite;
    secure: boolean;
    value: string;
  }>;
  origins: [];
};

export function buildInvitedAdultRecords(input: {
  emailHmac: string;
  now: Date;
  userId: string;
}) {
  const timestamp = input.now.toISOString();
  return {
    invitation: {
      accepted_user_id: input.userId,
      expires_at: new Date(
        input.now.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      normalized_email_hmac: input.emailHmac,
      status: "ACCEPTED" as const,
    },
    profile: {
      age_confirmed_at: timestamp,
      birth_year: 2000,
      consented_at: timestamp,
      onboarding_state: "IN_PROGRESS",
      privacy_version: CURRENT_POLICY_VERSIONS.privacyVersion,
      responsible_use_version: CURRENT_POLICY_VERSIONS.responsibleUseVersion,
      terms_version: CURRENT_POLICY_VERSIONS.termsVersion,
      user_id: input.userId,
    },
  };
}

function parseValue(rawValue: string): string {
  const value = rawValue.trim();
  if (!value.startsWith('"')) return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

export function parseSupabaseStatusEnvironment(
  output: string,
): LocalSupabaseEnvironment {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line.trim());
    if (match) values.set(match[1], parseValue(match[2]));
  }

  const supabaseUrl = values.get("API_URL");
  const publishableKey =
    values.get("PUBLISHABLE_KEY") ?? values.get("ANON_KEY");
  const secretKey = values.get("SECRET_KEY") ?? values.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) {
    throw new Error("Local Supabase status is missing required E2E values.");
  }

  const url = new URL(supabaseUrl);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new Error("E2E session provisioning requires local Supabase.");
  }

  return { publishableKey, secretKey, supabaseUrl: url.origin };
}

export function discoverLocalSupabaseEnvironment(
  projectDirectory = process.cwd(),
): LocalSupabaseEnvironment {
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: projectDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseSupabaseStatusEnvironment(output);
}

function sameSite(value: CookieOptions["sameSite"]): PlaywrightSameSite {
  if (value === "none") return "None";
  if (value === "strict") return "Strict";
  return "Lax";
}

export function toPlaywrightStorageState(
  cookies: SsrCookie[],
  appUrl: URL,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): PlaywrightStorageState {
  return {
    cookies: cookies.map((cookie) => ({
      domain: appUrl.hostname,
      expires:
        typeof cookie.options.maxAge === "number"
          ? nowEpochSeconds + cookie.options.maxAge
          : -1,
      httpOnly: cookie.options.httpOnly ?? true,
      name: cookie.name,
      path: cookie.options.path ?? "/",
      sameSite: sameSite(cookie.options.sameSite),
      secure: cookie.options.secure ?? appUrl.protocol === "https:",
      value: cookie.value,
    })),
    origins: [],
  };
}

export async function provisionLocalInvitedAdult(input: {
  appUrl: URL;
  environment: LocalSupabaseEnvironment;
}): Promise<{
  cleanup(): Promise<void>;
  storageState: PlaywrightStorageState;
}> {
  parseSupabaseStatusEnvironment(
    `API_URL=${input.environment.supabaseUrl}\n` +
      `PUBLISHABLE_KEY=${input.environment.publishableKey}\n` +
      `SECRET_KEY=${input.environment.secretKey}`,
  );

  const administrator = createClient(
    input.environment.supabaseUrl,
    input.environment.secretKey,
    { auth: STATELESS_AUTH },
  );
  const email = `storybridge-e2e-${randomUUID()}@example.test`;
  const password = randomBytes(32).toString("base64url");
  const created = await administrator.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error("Could not create the local E2E identity.");
  }
  const userId = created.data.user.id;

  const cleanup = async () => {
    const invitationDeletion = await administrator
      .schema("private")
      .from("beta_invitations")
      .delete()
      .eq("accepted_user_id", userId);
    const userDeletion = await administrator.auth.admin.deleteUser(userId);
    if (invitationDeletion.error || userDeletion.error) {
      throw new Error("Could not clean up the local E2E identity.");
    }
  };

  try {
    const records = buildInvitedAdultRecords({
      emailHmac: `v1.${randomBytes(32).toString("base64url")}`,
      now: new Date(),
      userId,
    });
    const invitation = await administrator
      .schema("private")
      .from("beta_invitations")
      .insert(records.invitation);
    if (invitation.error) throw invitation.error;
    const profile = await administrator
      .from("profiles")
      .insert(records.profile);
    if (profile.error) throw profile.error;

    const cookieJar = new Map<string, SsrCookie>();
    const session = createServerClient(
      input.environment.supabaseUrl,
      input.environment.publishableKey,
      {
        cookieOptions: {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: input.appUrl.protocol === "https:",
        },
        cookies: {
          getAll: () => [...cookieJar.values()],
          setAll: (cookies) => {
            for (const cookie of cookies) cookieJar.set(cookie.name, cookie);
          },
        },
      },
    );
    const signedIn = await session.auth.signInWithPassword({ email, password });
    if (signedIn.error || cookieJar.size === 0) {
      throw new Error("Could not create the local E2E session.");
    }

    return {
      cleanup,
      storageState: toPlaywrightStorageState(
        [...cookieJar.values()],
        input.appUrl,
      ),
    };
  } catch {
    await cleanup();
    throw new Error("Could not provision the local invited-adult E2E state.");
  }
}

export async function prepareLocalInvitedAdultStorageState(input: {
  appUrl: URL;
  path: string;
}): Promise<() => Promise<void>> {
  const provisioned = await provisionLocalInvitedAdult({
    appUrl: input.appUrl,
    environment: discoverLocalSupabaseEnvironment(),
  });
  try {
    await mkdir(dirname(input.path), { recursive: true });
    await writeFile(input.path, JSON.stringify(provisioned.storageState), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    await provisioned.cleanup();
    throw error;
  }

  return async () => {
    try {
      await provisioned.cleanup();
    } finally {
      await rm(input.path, { force: true });
    }
  };
}
