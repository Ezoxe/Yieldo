import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.YIELDO_URL ?? "http://127.0.0.1:5173";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "screenshots-invest");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
for (const theme of ["dark", "light"]) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 }, deviceScaleFactor: 1, locale: "fr-FR",
    });
    await context.addInitScript((chosen) => {
      localStorage.setItem("yieldo.motion-disabled", "true");
      localStorage.setItem("yieldo.theme", chosen);
    }, theme);
    const page = await context.newPage();
    await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/Adresse e-?mail/i).fill("max@example.com");
    await page.getByLabel(/Mot de passe/i).fill("motdepasse123");
    await page.getByRole("button", { name: /Se connecter/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/connexion"));

    await page.goto(`${BASE}/invest/decisions`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Décisions", level: 1 }).waitFor();
    const rows = page.locator(".yd-feed__summary");
    const count = await rows.count();
    let index = 0;
    for (let i = 0; i < count; i += 1) {
      if ((await rows.nth(i).textContent())?.includes("Refusé")) { index = i; break; }
    }
    await rows.nth(index).click();
    const item = page.locator(".yd-feed__item").nth(index);
    await item.locator(".yd-feed__detail").waitFor();
    await page.waitForTimeout(500);
    await item.screenshot({ path: path.join(OUT, `detail-${theme}-${width}.png`) });
    console.log(`detail-${theme}-${width}.png`);
    await context.close();
  }
}
await browser.close();
