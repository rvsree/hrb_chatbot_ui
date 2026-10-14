import { test, expect } from "@playwright/test";

// Covers the exact bug chased through manual testing on 2026-10-13: an
// admin clicks a DocLink bookmark tooltip (e.g. "RAG Pipeline:"), picks a
// doc type from the popover (Spec/Architecture/Design/Decisions), and a
// new tab should open with the real document - not silently do nothing.
//
// Needs TEST_ADMIN_SECRET_CODE set locally (never commit a real value) -
// the admin's own current secret code, since only an admin sees these
// links at all. Skips cleanly when it's not set, so this doesn't break
// for anyone who hasn't configured it.
const ADMIN_SECRET_CODE = process.env.TEST_ADMIN_SECRET_CODE;

test.describe("admin doc link popover", () => {
  test.skip(!ADMIN_SECRET_CODE, "Set TEST_ADMIN_SECRET_CODE to run this test");

  test("clicking a popover doc type opens a real document in a new tab", async ({ page, context }) => {
    await page.goto("/login");
    await page.locator("#employee-id").fill("ADM001");
    await page.locator("#full-name").fill("Sree Rad");
    await page.locator("#role").selectOption("admin");
    await page.locator("#secret-code").fill(ADMIN_SECRET_CODE!);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/(chat|admin\/reset-secret-code)/);
    if (page.url().includes("reset-secret-code")) {
      test.skip(true, "Admin is mid-forced-reset - log in normally once first to clear that state");
    }

    const bookmarkButton = page.locator(".doc-link-button").first();
    await expect(bookmarkButton).toBeVisible();
    await bookmarkButton.click();

    const popoverItem = page.locator(".doc-link-popover-item").first();
    await expect(popoverItem).toBeVisible();

    const [newPage] = await Promise.all([context.waitForEvent("page"), popoverItem.click()]);
    await newPage.waitForLoadState("domcontentloaded");

    // A failed doc open lands on an S3 AccessDenied/error XML page or our
    // own error card - a real doc has a <title> and no error text.
    const bodyText = await newPage.locator("body").innerText();
    expect(bodyText).not.toMatch(/AccessDenied|Could not open|error occurred/i);
  });
});
