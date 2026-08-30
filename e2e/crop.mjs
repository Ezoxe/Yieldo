/**
 * Section-by-section captures of /faisabilite at one viewport, for reading the
 * copy and the layout at a legible scale. A 7 800px-tall full-page PNG scaled
 * to fit a review pane shows a shape, not a screen.
 *
 *   node crop.mjs <width> <theme>
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const WIDTH = Number(process.argv[2] ?? 375);
const THEME = process.argv[3] ?? "dark";
const BASE = process.env.YIELDO_URL ?? "http://localhost:5173";
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.superpowers/sdd/2026-08-24-yieldo-phase-2b-decision/screenshots/crops",
);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 900 },
  locale: "fr-FR",
});
const page = await context.newPage();

await page.goto(`${BASE}/connexion`);
await page.evaluate((t) => localStorage.setItem("yieldo.theme", t), THEME);
await page.reload();
await page.fill("#login-email", "demo@yieldo-demo.fr");
await page.fill("#login-password", "MotDePasseDemo123!");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 20000 });

await page.goto(`${BASE}/faisabilite`);
await page.waitForSelector("text=Ce que vos relevés mesurent", { timeout: 20000 });
await page.getByLabel(/Prix du bien/).fill("40000");
await page.getByLabel(/Échéance \(mois\)/).fill("12");
await page.getByRole("button", { name: /Calculer la faisabilité/ }).click();
await page.waitForSelector('[data-testid="yd-lever-borrow"]', { timeout: 20000 });
await page.waitForTimeout(900);

const cells = page.locator(".yd-bento__cell");
const count = await cells.count();
for (let index = 0; index < count; index += 1) {
  await cells
    .nth(index)
    .screenshot({ path: path.join(OUT, `${WIDTH}-${THEME}-${index}.png`) });
}
console.log(`captured ${count} cells at ${WIDTH}px, ${THEME}`);

await browser.close();
