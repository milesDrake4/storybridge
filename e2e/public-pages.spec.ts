import { expect, test } from "@playwright/test";

const publicPages = [
  { heading: "Discover what only you can say.", path: "/" },
  { heading: "Simple beta pricing.", path: "/pricing" },
  { heading: "Privacy Notice", path: "/privacy" },
  { heading: "Terms", path: "/terms" },
  { heading: "Keep the writing yours.", path: "/responsible-use" },
  { heading: "Beta support", path: "/support" },
  { heading: "Account deletion", path: "/account-deletion" },
] as const;

for (const publicPage of publicPages) {
  test(`${publicPage.path} is a complete public surface`, async ({ page }) => {
    await page.goto(publicPage.path);

    await expect(
      page.getByRole("heading", { level: 1, name: publicPage.heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Support" })).toBeVisible();
  });
}

test("public navigation exposes pricing and responsible-use boundaries", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Pricing" }).first().click();

  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByText("$24.99")).toBeVisible();
  await page.getByRole("link", { name: "Responsible Use" }).first().click();
  await expect(page).toHaveURL(/\/responsible-use$/);
  await expect(page.getByText(/cannot be accepted or exported/i)).toBeVisible();
});
