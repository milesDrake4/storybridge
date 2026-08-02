import { expect, test } from "@playwright/test";

test("requests an invited sign-in link with fixed, responsive UI", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 320 });
  await page.route("**/api/v1/auth/magic-links", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.postDataJSON()).toEqual({
      email: "student@example.com",
      inviteToken: "invite-token",
    });
    await route.fulfill({
      body: JSON.stringify({ data: { accepted: true } }),
      contentType: "application/json",
      status: 202,
    });
  });

  await page.goto("/sign-in?invite=invite-token");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.keyboard.type("student@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toContainText(
    "If your invitation is valid",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("recovers from callback failure without exposing provider details", async ({
  page,
}) => {
  await page.goto(
    "/sign-in?error=AUTH_CALLBACK_FAILED&provider_error=private-diagnostic",
  );

  await expect(page.getByRole("alert")).toHaveText(
    "That sign-in link could not be used. Request a new one below.",
  );
  await expect(page.getByText(/private-diagnostic/i)).toHaveCount(0);
});

test("records adult consent and continues to the dashboard", async ({
  page,
}) => {
  let requestBody: unknown;
  await page.route("**/api/v1/me/consent", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({ data: { accepted: true } }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/dashboard", (route) =>
    route.fulfill({ body: "<h1>Your story starts here.</h1>", status: 200 }),
  );

  await page.goto("/consent");
  await page.getByLabel("Birth year").selectOption("2000");
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByLabel(/I agree to the Terms/i).check();
  await page.getByLabel(/I acknowledge the Privacy Notice/i).check();
  await page.getByLabel(/I agree to use StoryBridge responsibly/i).check();
  await page.getByRole("button", { name: "Enter StoryBridge" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  expect(requestBody).toEqual({
    ageConfirmed: true,
    birthYear: 2000,
    privacyVersion: "privacy-2026-08-02",
    responsibleUseVersion: "responsible-use-2026-08-02",
    termsVersion: "terms-2026-08-02",
  });
});

test("redirects signed-out dashboard requests to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Sign in with a secure email link." }),
  ).toBeVisible();
});
