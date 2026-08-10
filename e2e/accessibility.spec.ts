import { expect, test, type Page } from "@playwright/test";
import { source } from "axe-core";

type AxeViolation = {
  id: string;
  impact: string | null;
  nodes: Array<{ target: unknown }>;
};

async function expectNoSeriousAxeViolations(page: Page) {
  await page.addScriptTag({ content: source });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run(
            root: Document,
            options: object,
          ): Promise<{ violations: AxeViolation[] }>;
        };
      }
    ).axe;
    const result = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    );
  });
  expect(violations).toEqual([]);
}

for (const path of [
  "/",
  "/pricing",
  "/privacy",
  "/responsible-use",
  "/sign-in",
] as const) {
  test(`${path} has no serious automated accessibility violations`, async ({
    page,
  }) => {
    await page.goto(path);
    await expectNoSeriousAxeViolations(page);
  });
}

test("public content fits a 320 CSS-pixel viewport", async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto("/");

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("keyboard users can skip navigation and reach sign in", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Invited? Sign in" }),
  ).toBeFocused();
});
