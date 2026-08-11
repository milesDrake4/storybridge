type ConfirmationUrlContext = {
  appUrl: URL;
  redirectTo?: string;
  supabaseUrl: URL;
  type?: string;
};

const ALLOWED_CONFIRMATION_KEYS = new Set(["redirect_to", "token", "type"]);
const CALLBACK_PATH = "/api/v1/auth/callback";
const VERIFY_PATH = "/auth/v1/verify";

function hasUniqueAllowedKeys(searchParams: URLSearchParams): boolean {
  const keys = [...searchParams.keys()];
  return (
    new Set(keys).size === keys.length &&
    keys.every((key) => ALLOWED_CONFIRMATION_KEYS.has(key))
  );
}

export function parseSupabaseConfirmationUrl(
  value: string,
  context: ConfirmationUrlContext,
): URL | null {
  if (value.length < 1 || value.length > 8_192) return null;

  let confirmationUrl: URL;
  try {
    confirmationUrl = new URL(value);
  } catch {
    return null;
  }

  if (
    confirmationUrl.origin !== context.supabaseUrl.origin ||
    confirmationUrl.pathname !== VERIFY_PATH ||
    confirmationUrl.username !== "" ||
    confirmationUrl.password !== "" ||
    confirmationUrl.hash !== ""
  ) {
    return null;
  }

  if (!confirmationUrl.searchParams.has("type") && context.type) {
    confirmationUrl.searchParams.set("type", context.type);
  }
  if (!confirmationUrl.searchParams.has("redirect_to") && context.redirectTo) {
    confirmationUrl.searchParams.set("redirect_to", context.redirectTo);
  }
  if (!hasUniqueAllowedKeys(confirmationUrl.searchParams)) return null;

  const token = confirmationUrl.searchParams.get("token");
  if (!token || token.length > 2_048) return null;
  if (confirmationUrl.searchParams.get("type") !== "magiclink") return null;

  const redirectValue = confirmationUrl.searchParams.get("redirect_to");
  if (!redirectValue || redirectValue.length > 2_048) return null;

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectValue);
  } catch {
    return null;
  }
  if (
    redirectUrl.origin !== context.appUrl.origin ||
    redirectUrl.pathname !== CALLBACK_PATH ||
    redirectUrl.search !== "" ||
    redirectUrl.hash !== "" ||
    redirectUrl.username !== "" ||
    redirectUrl.password !== ""
  ) {
    return null;
  }

  return confirmationUrl;
}
