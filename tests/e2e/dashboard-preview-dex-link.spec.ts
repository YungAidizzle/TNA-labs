import { expect, test } from "@playwright/test";

test("validation preview dexscreener link tracks the selected coin", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/preview/dashboard-hero", { waitUntil: "networkidle" });

  const validationPane = page.getByTestId("selected-coin-panel");
  const dexscreenerLink = validationPane.getByTestId("selected-coin-dexscreener-link");

  await expect(validationPane).toContainText("Bonk");
  await expect(dexscreenerLink).toHaveAttribute(
    "href",
    "https://dexscreener.com/solana/dezxca1rz4yhf2fk8n1gzvxhzk8bukkf4g4ndztyprb",
  );
  await expect(dexscreenerLink).toHaveAttribute("target", "_blank");

  await page.getByTestId("memecoin-market-row").filter({ hasText: "Brett" }).click();

  await expect(validationPane).toContainText("Brett");
  await expect(dexscreenerLink).toHaveAttribute("href", "https://dexscreener.com/base/brett");

  await page.getByTestId("memecoin-market-row").filter({ hasText: "Pepe" }).click();

  await expect(validationPane).toContainText("Pepe");
  await expect(dexscreenerLink).toHaveAttribute("href", "https://dexscreener.com/ethereum/pepe");
});

test("validation preview keeps the dexscreener action aligned in the chart preview header when the column narrows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/preview/dashboard-hero", { waitUntil: "networkidle" });

  await page.evaluate(() => {
    const validation = document.querySelector("#validation");
    if (!(validation instanceof HTMLElement)) {
      return;
    }

    validation.style.width = "300px";
    validation.style.minWidth = "300px";
    validation.style.maxWidth = "300px";

    const workspace = validation.parentElement;
    if (workspace instanceof HTMLElement) {
      workspace.style.gridTemplateColumns = "360px 560px 300px";
    }
  });

  const validationPane = page.getByTestId("selected-coin-panel");
  const layout = await validationPane.evaluate((panel) => {
    const chartLabel = Array.from(panel.querySelectorAll("p")).find((node) => node.textContent?.trim() === "Chart Preview");
    const dexscreenerLink = panel.querySelector('[data-testid="selected-coin-dexscreener-link"]');
    const previewCard = Array.from(panel.querySelectorAll("div")).find((node) => {
      const className = typeof node.className === "string" ? node.className : "";
      return className.includes("relative") && className.includes("h-[320px]") && className.includes("bg-[#050911]");
    });

    const chartLabelRect = chartLabel?.getBoundingClientRect();
    const dexscreenerLinkRect = dexscreenerLink?.getBoundingClientRect();
    const previewCardRect = previewCard?.getBoundingClientRect();

    return {
      chartLabelTop: chartLabelRect?.top ?? null,
      dexscreenerLinkTop: dexscreenerLinkRect?.top ?? null,
      dexscreenerLinkBottom: dexscreenerLinkRect?.bottom ?? null,
      previewCardTop: previewCardRect?.top ?? null,
    };
  });

  expect(layout.chartLabelTop).not.toBeNull();
  expect(layout.dexscreenerLinkTop).not.toBeNull();
  expect(layout.dexscreenerLinkBottom).not.toBeNull();
  expect(layout.previewCardTop).not.toBeNull();

  expect(Math.abs((layout.dexscreenerLinkTop ?? 0) - (layout.chartLabelTop ?? 0))).toBeLessThanOrEqual(6);
  expect(layout.previewCardTop).toBeGreaterThan((layout.dexscreenerLinkBottom ?? 0) + 6);
});
