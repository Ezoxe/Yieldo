/**
 * The browser gate for the Investissement environment.
 *
 * Not a test. It drives a real Chromium against a seeded instance, saves
 * full-page PNGs at 390 and 1440 in both themes, and reports the three things
 * a passing Vitest suite has never once caught in this project: horizontal
 * overflow on <body>, console errors, and the measured contrast of text
 * against the pixel actually painted behind it.
 *
 *   YIELDO_URL=http://127.0.0.1:5173 node shoot-invest.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.YIELDO_URL ?? "http://127.0.0.1:5173";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR ?? path.resolve(HERE, "screenshots-invest");

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
];

const SCREENS = [
  { slug: "controle", url: "/invest", ready: "Salle de contrôle" },
  { slug: "decisions", url: "/invest/decisions", ready: "Décisions" },
  { slug: "mandat", url: "/invest/mandat", ready: "Mandat" },
  { slug: "modele", url: "/invest/modele", ready: "Modèle de décision" },
  { slug: "courtiers", url: "/invest/courtiers", ready: "Courtiers" },
  { slug: "supervision", url: "/invest/supervision", ready: "Supervision" },
  // The screen the whole feature exists for: one decision, unfolded into the
  // indicators it saw, the questions it was asked and what the mandate did.
  { slug: "decision-detail", url: "/invest/decisions", ready: "Décisions", expandFirst: true },
];

/** Text/background pairings this environment introduces, measured on the
 *  painted pixel rather than on the token. */
const CONTRAST = [
  ".yd-pill--positive",
  ".yd-pill--negative",
  ".yd-pill--warning",
  ".yd-pill--info",
  ".yd-figure__label",
  ".yd-figure__value",
  ".yd-funnel__label",
  ".yd-funnel__share",
  ".yd-note",
  ".yd-table thead th",
  ".yd-calib__caption",
  ".yd-env__current",
];

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg, bg) {
  const a = relativeLuminance(fg) + 0.05;
  const b = relativeLuminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

function parseColour(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function over(fg, bg, alpha) {
  return fg.map((channel, index) => channel * alpha + bg[index] * (1 - alpha));
}

async function measureContrast(page, selectors) {
  return page.evaluate((list) => {
    const out = [];
    for (const selector of list) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const style = getComputedStyle(element);
      // Walk up for the first ancestor that actually paints a background.
      let node = element;
      const stack = [];
      while (node) {
        const background = getComputedStyle(node).backgroundColor;
        if (background && background !== "rgba(0, 0, 0, 0)") stack.push(background);
        node = node.parentElement;
      }
      out.push({
        selector,
        color: style.color,
        backgrounds: stack,
        text: (element.textContent ?? "").trim().slice(0, 40),
      });
    }
    return out;
  }, selectors);
}

function flatten(backgrounds) {
  // Compose the painted stack back to front onto an opaque base.
  let base = [7, 7, 10];
  for (const raw of [...backgrounds].reverse()) {
    const parsed = parseColour(raw);
    if (!parsed) continue;
    base = over(parsed.rgb, base, parsed.alpha);
  }
  return base;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const problems = [];

  for (const theme of ["dark", "light"]) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        locale: "fr-FR",
      });
      await context.addInitScript((chosen) => {
        // Entrance animations stall in a hidden pane and leave a screen faded.
        localStorage.setItem("yieldo.motion-disabled", "true");
        localStorage.setItem("yieldo.theme", chosen);
      }, theme);

      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(String(error)));

      await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
      await page.getByLabel(/Adresse e-?mail/i).fill("max@example.com");
      await page.getByLabel(/Mot de passe/i).fill("motdepasse123");
      await page.getByRole("button", { name: /Se connecter/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/connexion"), { timeout: 15_000 });

      for (const screen of SCREENS) {
        await page.goto(`${BASE}${screen.url}`, { waitUntil: "domcontentloaded" });
        try {
          await page.getByRole("heading", { name: screen.ready, level: 1 })
            .waitFor({ timeout: 15_000 });
        } catch {
          problems.push(`${screen.slug} ${theme} ${viewport.name}: titre « ${screen.ready} » absent`);
          continue;
        }
        if (screen.expandFirst) {
          const rows = page.locator(".yd-feed__summary");
          const count = await rows.count();
          // Prefer a decision the mandate refused: it is the one whose detail
          // has every section filled in.
          let index = 0;
          for (let i = 0; i < count; i += 1) {
            if ((await rows.nth(i).textContent())?.includes("Refusé")) { index = i; break; }
          }
          await rows.nth(index).click();
          await page.locator(".yd-feed__detail").first().waitFor({ timeout: 15_000 });
        }
        await page.waitForTimeout(600);

        const overflow = await page.evaluate(() => {
          const box = document.documentElement;
          return {
            scrollWidth: box.scrollWidth,
            clientWidth: box.clientWidth,
            overflowing: box.scrollWidth > box.clientWidth + 1,
          };
        });
        if (overflow.overflowing) {
          problems.push(
            `${screen.slug} ${theme} ${viewport.name}: débordement horizontal `
            + `(${overflow.scrollWidth} > ${overflow.clientWidth})`,
          );
        }

        if (viewport.name === "1440") {
          for (const measured of await measureContrast(page, CONTRAST)) {
            const fg = parseColour(measured.color);
            if (!fg) continue;
            const background = flatten(measured.backgrounds);
            const composed = over(fg.rgb, background, fg.alpha);
            const value = ratio(composed, background);
            if (value < 4.5) {
              problems.push(
                `${screen.slug} ${theme}: ${measured.selector} contraste ${value.toFixed(2)}:1 `
                + `(« ${measured.text} »)`,
              );
            }
          }
        }

        await page.screenshot({
          path: path.join(OUT, `${screen.slug}-${theme}-${viewport.name}.png`),
          fullPage: true,
        });
      }

      if (errors.length) {
        problems.push(`${theme} ${viewport.name}: ${errors.length} erreur(s) console — ${errors[0]}`);
      }
      await context.close();
    }
  }

  await browser.close();

  if (problems.length === 0) {
    console.log("AUCUN PROBLÈME : pas de débordement, pas d'erreur console, contraste ≥ 4,5:1.");
  } else {
    console.log(`${problems.length} PROBLÈME(S) :`);
    for (const problem of [...new Set(problems)]) console.log("  -", problem);
  }
  console.log(`captures dans ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
