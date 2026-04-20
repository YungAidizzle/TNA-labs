import { expect, test } from "@playwright/test";

test.setTimeout(240_000);

test("dashboard keeps staged navigation curated without unlocking placeholder modules", async ({ page }) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/trends(\?.*)?$/);

  await expect(page.locator('a[href="/trends"]')).toBeVisible();
  await expect(page.locator('a[href="/watchlist"]')).toHaveCount(0);
  await expect(page.locator('a[href="/alerts"]')).toHaveCount(0);
  await expect(page.locator('a[href="/narratives"]')).toHaveCount(0);
  await expect(page.locator('a[href="/memecoins"]')).toHaveCount(0);
  await expect(page.locator('a[href="/api-data-export"]')).toHaveCount(0);
  await expect(page.locator('a[href="/momentum"]')).toHaveCount(0);
  await expect(page.locator('a[href="/influencers"]')).toHaveCount(0);
  await expect(page.locator('a[href="/historical-replay"]')).toHaveCount(0);
  await expect(page.locator('a[href="/settings"]')).toHaveCount(0);
  await expect(page.getByLabel("Workspace").getByText("Watchlist", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Workspace").getByText("Alerts", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Intelligence").getByText("Narratives", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Intelligence").getByText("Memecoins", { exact: true })).toBeVisible();
  await expect(page.getByLabel("System").getByText("API / Data Export", { exact: true })).toBeVisible();
  await expect(page.getByText("Active narratives")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/^Avg confidence$/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByPlaceholder("Search narratives")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/^Validation$/)).toBeVisible({ timeout: 45_000 });

  await page.keyboard.press("Control+K");
  await expect(page.getByPlaceholder("Jump to a module")).toBeVisible({ timeout: 45_000 });
  await page.getByPlaceholder("Jump to a module").fill("historical replay");
  await page.getByText("Historical Replay", { exact: true }).click();
  await expect(page).toHaveURL(/\/trends(\?.*)?$/, { timeout: 45_000 });
  await page.keyboard.press("Escape");

  await page.goto("/watchlist", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/trends(\?.*)?$/, { timeout: 45_000 });

  await page.goto("/memecoins", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/trends(\?.*)?$/, { timeout: 45_000 });

  await page.goto("/dataset-api", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/trends(\?.*)?$/, { timeout: 45_000 });

  await page.goto("/narrative-explorer/test-narrative", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/trends\?selected=test-narrative$/, { timeout: 45_000 });
});
