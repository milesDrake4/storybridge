import { EligibilityError } from "@/services/auth/eligibility";

export function productAccessRedirect(error: unknown): string | null {
  if (!(error instanceof EligibilityError)) return null;

  switch (error.code) {
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return "/sign-in";
    case "CONSENT_REQUIRED":
      return "/consent";
    case "INVITATION_REQUIRED":
      return "/sign-in?error=INVITATION_REQUIRED";
    case "BETA_AGE_RESTRICTED":
      return "/sign-in?error=BETA_AGE_RESTRICTED";
  }
}
