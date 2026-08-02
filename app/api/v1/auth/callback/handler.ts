import { authCallbackQuerySchema } from "@/contracts/http/v1/auth";

const ALLOWED_REDIRECTS = new Set(["/consent", "/dashboard"]);
const DEFAULT_REDIRECT = "/consent";
const FAILURE_REDIRECT = "/sign-in?error=AUTH_CALLBACK_FAILED";

type AuthCallbackDependencies = {
  appUrl: URL;
  exchange(code: string): Promise<void>;
};

function redirect(location: URL): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store",
      Location: location.href,
      "X-Request-Id": crypto.randomUUID(),
    },
    status: 303,
  });
}

function parseCallbackQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    return null;
  }
  const parsed = authCallbackQuerySchema.safeParse(Object.fromEntries(entries));
  if (!parsed.success) return null;
  const next = parsed.data.next ?? DEFAULT_REDIRECT;
  return ALLOWED_REDIRECTS.has(next) ? { ...parsed.data, next } : null;
}

export function createAuthCallbackGetHandler(
  dependencies: AuthCallbackDependencies,
) {
  return async function getAuthCallback(request: Request): Promise<Response> {
    const query = parseCallbackQuery(request);
    if (!query) {
      return redirect(new URL(FAILURE_REDIRECT, dependencies.appUrl));
    }

    try {
      await dependencies.exchange(query.code);
      return redirect(new URL(query.next, dependencies.appUrl));
    } catch {
      return redirect(new URL(FAILURE_REDIRECT, dependencies.appUrl));
    }
  };
}
