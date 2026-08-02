import {
  createServerClient,
  type CookieMethodsServer,
  type CookieOptions,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/adapters/supabase/database.types";
import type { ServerConfig } from "@/lib/config/server";

const STATELESS_AUTH_OPTIONS = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
} as const;

export function supabaseAuthCookieOptions(appUrl: URL): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: appUrl.protocol === "https:",
  };
}

export function createSupabasePublicClient(config: ServerConfig) {
  return createClient<Database>(
    config.supabaseUrl.href,
    config.supabasePublishableKey,
    STATELESS_AUTH_OPTIONS,
  );
}

export function createSupabaseSecretClient(config: ServerConfig) {
  return createClient<Database>(
    config.supabaseUrl.href,
    config.supabaseSecretKey,
    STATELESS_AUTH_OPTIONS,
  );
}

export function createSupabaseSessionClient(
  config: ServerConfig,
  cookies: CookieMethodsServer,
) {
  return createServerClient<Database>(
    config.supabaseUrl.href,
    config.supabasePublishableKey,
    { cookieOptions: supabaseAuthCookieOptions(config.appUrl), cookies },
  );
}
