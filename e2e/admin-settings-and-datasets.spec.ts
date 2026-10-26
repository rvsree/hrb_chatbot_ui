import { test, expect } from "@playwright/test";

// Phase 1 - Live Queries/Synthetic Dataset tabs and the new Settings page
// (Model/Memory/Resiliency), all ADMIN-only (isEngineeringAdmin gate in
// AdminDashboardPage.tsx), backed by hrb_chatbot_service's Phase 257/260
// app-settings and live-queries/synthetic-dataset routes.
//
// Same TEST_ADMIN_SECRET_CODE prerequisite/skip convention as
// admin-doc-links.spec.ts - only an admin sees any of these tabs at all.
const ADMIN_SECRET_CODE = process.env.TEST_ADMIN_SECRET_CODE;

test.describe("admin settings and datasets", () => {
  test.skip(!ADMIN_SECRET_CODE, "Set TEST_ADMIN_SECRET_CODE to run this test");

  test.beforeEach(async ({ page }) => {
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
  });

  test("Live Queries tab loads and the LTM filter re-fetches", async ({ page }) => {
    await page.goto("/admin?tab=live-queries");
    await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();

    const table = page.locator(".documents-table");
    await expect(table).toBeVisible();

    await page.locator("select").first().selectOption("ltm");
    // A real re-fetch happened if the page didn't error - the row count
    // itself depends on live data, so this only proves the control works,
    // not a specific count.
    await expect(page.locator(".error-banner")).toHaveCount(0);
  });

  test("Synthetic Dataset tab loads and a row opens its detail modal", async ({ page }) => {
    await page.goto("/admin?tab=synthetic-dataset");
    await expect(page.locator(".documents-table")).toBeVisible();

    const firstRow = page.locator(".documents-table tbody tr").first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await expect(page.locator(".modal-card")).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
    }
  });

  test("Settings page: each sub-tab loads a field and Save round-trips", async ({ page }) => {
    await page.goto("/admin?tab=settings");

    // Model sub-tab is the default.
    const judgeProviderSelect = page.locator("#setting-judge_provider_default");
    await expect(judgeProviderSelect).toBeVisible();
    const currentValue = await judgeProviderSelect.inputValue();
    await judgeProviderSelect.selectOption(currentValue);
    await page.getByRole("button", { name: /^save$/i }).first().click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

    // Memory sub-tab.
    await page.getByRole("button", { name: "Memory" }).click();
    await expect(page.locator("#setting-ltm_score_threshold")).toBeVisible();

    // Resiliency sub-tab - 5 fields.
    await page.getByRole("button", { name: "Resiliency" }).click();
    await expect(page.locator("#setting-react_loop_max_iterations")).toBeVisible();
    await expect(page.locator("#setting-llm_openai_circuit_breaker_failure_threshold")).toBeVisible();
  });
});
