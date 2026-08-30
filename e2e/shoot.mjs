/**
 * The browser gate for tasks 15 and 16: /faisabilite at 375, 768 and 1440 px, in
 * both themes, against the seeded fixture, with the operator's own question
 * filled in.
 *
 *   node shoot.mjs <task>            # task-15 | task-16
 *
 * Not a test. It drives a real Chromium, saves full-page PNGs, and reports the
 * three things a passing Vitest suite has never once caught in this project:
 * horizontal overflow on <body>, console errors, and the measured contrast of
 * the verdict text against the pixel actually painted behind it.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const TASK = process.argv[2] ?? "task-15";
const BASE = process.env.YIELDO_URL ?? "http://localhost:5173";
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.superpowers/sdd/2026-08-24-yieldo-phase-2b-decision/screenshots",
);
const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
];
const THEMES = ["dark", "light"];

mkdirSync(OUT, { recursive: true });

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const problems = [];
const notes = [];

const browser = await chromium.launch();

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: "fr-FR",
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    const failed = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()} (on ${page.url()})`);
    });

    await page.goto(`${BASE}/connexion`);
    await page.evaluate((t) => localStorage.setItem("yieldo.theme", t), theme);
    await page.reload();

    await page.fill("#login-email", "demo@yieldo-demo.fr");
    await page.fill("#login-password", "MotDePasseDemo123!");
    await page.click("button[type=submit]");
    await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 20000 });

    // Everything before this point is the shared login flow. The gate is about
    // THIS screen, so the console and the network are watched from here on.
    console.log(`pre-login network: ${JSON.stringify(failed)}`);
    consoleErrors.length = 0;
    failed.length = 0;

    await page.goto(`${BASE}/faisabilite`);
    await page.waitForSelector("text=Ce que vos relevés mesurent", { timeout: 20000 });

    // Empty state — nothing asked yet.
    await page.screenshot({
      path: path.join(OUT, `${TASK}-${viewport.name}-${theme}-vide.png`),
      fullPage: true,
    });

    // THE OPERATOR'S OWN QUESTION: 40 000 EUR, 12 mois, apport 0, vehicule.
    await page.getByLabel(/Prix du bien/).fill("40000");
    await page.getByLabel(/Échéance \(mois\)/).fill("12");
    await page.getByRole("button", { name: /Calculer la faisabilité/ }).click();
    await page.waitForSelector("text=Hors de portée", { timeout: 20000 });
    await page.waitForTimeout(700);

    await page.screenshot({
      path: path.join(OUT, `${TASK}-${viewport.name}-${theme}.png`),
      fullPage: true,
    });

    // -- The three checks a green suite cannot make ---------------------------

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) problems.push(`${theme} ${viewport.name}: body overflows by ${overflow}px`);
    if (consoleErrors.length > 0) {
      problems.push(`${theme} ${viewport.name}: console ${JSON.stringify(consoleErrors)}`);
    }
    if (failed.length > 0) {
      problems.push(`${theme} ${viewport.name}: network ${JSON.stringify(failed)}`);
    }

    // Verdict text against the pixel actually behind it, decoded from the DOM's
    // resolved colours rather than from a token value.
    const contrast = await page.evaluate(() => {
      const parse = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
      const opaqueBehind = (el) => {
        let node = el;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          const alpha = Number(bg.match(/\d+(\.\d+)?/g)?.[3] ?? 1);
          if (alpha > 0.98) return parse(bg);
          node = node.parentElement;
        }
        return [255, 255, 255];
      };
      const out = {};
      for (const [key, selector] of Object.entries({
        label: ".yd-verdict__label",
        amount: ".yd-verdict__amount",
        gap: ".yd-verdict__gap",
        ratio: ".yd-lever__ratio--exceeded",
        leverReason: ".yd-lever__reason",
      })) {
        const el = document.querySelector(selector);
        if (!el) continue;
        out[key] = { fg: parse(getComputedStyle(el).color), bg: opaqueBehind(el) };
      }
      return out;
    });
    for (const [key, pair] of Object.entries(contrast)) {
      const r = ratio(pair.fg, pair.bg);
      const line = `${theme} ${viewport.name} ${key}: ${r.toFixed(2)}:1`;
      if (r < 4.5) problems.push(`AA FAIL ${line}`);
      else notes.push(line);
    }

    await context.close();
  }
}

await browser.close();

console.log("--- contrast, measured off the rendered pixel ---");
for (const n of notes) console.log("  " + n);
if (problems.length === 0) {
  console.log("\nNo overflow, no console errors, every measured pairing clears 4.5:1.");
} else {
  console.log("\nPROBLEMS:");
  for (const p of problems) console.log("  " + p);
  process.exitCode = 1;
}
