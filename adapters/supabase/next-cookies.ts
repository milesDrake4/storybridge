import type { CookieMethodsServer, CookieOptions } from "@supabase/ssr";

type NextCookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): unknown;
};

export function toSupabaseCookieMethods(
  cookieStore: NextCookieStore,
): CookieMethodsServer {
  return {
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      for (const cookie of cookiesToSet) {
        cookieStore.set(cookie.name, cookie.value, cookie.options);
      }
    },
  };
}
