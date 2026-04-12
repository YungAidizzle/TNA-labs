import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://127.0.0.1:3000";
const outputPath = path.join(rootDir, "public", "marketing", "dashboard-terminal-hero-hq.png");
const viewport = { width: 2400, height: 1500 };
const deviceScaleFactor = 2;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport, deviceScaleFactor });

try {
  await page.goto(`${baseUrl}/preview/dashboard-hero`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if ("fonts" in document) {
      await document.fonts.ready;
    }
  });
  await page.waitForTimeout(200);

  const capture = page.locator('[data-testid="dashboard-preview-capture"]');
  await capture.waitFor({ state: "visible" });

  const box = await capture.boundingBox();
  if (!box) {
    throw new Error("Preview capture surface was not rendered.");
  }

  await capture.screenshot({
    path: outputPath,
    type: "png",
    animations: "disabled",
    scale: "device",
  });

  const exportedWidth = Math.round(box.width * deviceScaleFactor);
  const exportedHeight = Math.round(box.height * deviceScaleFactor);

  console.log(
    `Exported dashboard hero screenshot to ${outputPath} at ${exportedWidth}x${exportedHeight} from ${baseUrl}.`,
  );
} finally {
  await page.close();
  await browser.close();
}
