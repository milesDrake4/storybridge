import { parseSupabaseConfirmationUrl } from "@/lib/security/supabase-confirmation-url";

const FAILURE_PATH = "/sign-in?error=AUTH_CALLBACK_FAILED";

type AuthConfirmationDependencies = {
  appUrl: URL;
  supabaseUrl: URL;
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

function failure(appUrl: URL): Response {
  return redirect(new URL(FAILURE_PATH, appUrl));
}

export function createAuthConfirmationPostHandler(
  dependencies: AuthConfirmationDependencies,
) {
  return async function postAuthConfirmation(
    request: Request,
  ): Promise<Response> {
    if (request.headers.get("origin") !== dependencies.appUrl.origin) {
      return failure(dependencies.appUrl);
    }
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/x-www-form-urlencoded")
    ) {
      return failure(dependencies.appUrl);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return failure(dependencies.appUrl);
    }
    const entries = [...form.entries()];
    if (
      entries.length !== 1 ||
      entries[0]?.[0] !== "confirmationUrl" ||
      typeof entries[0][1] !== "string"
    ) {
      return failure(dependencies.appUrl);
    }

    const confirmationUrl = parseSupabaseConfirmationUrl(entries[0][1], {
      appUrl: dependencies.appUrl,
      supabaseUrl: dependencies.supabaseUrl,
    });
    return confirmationUrl
      ? redirect(confirmationUrl)
      : failure(dependencies.appUrl);
  };
}
