/**
 * The browser gate: one screen at 375, 768 and 1440 px, in both themes, against
 * the seeded fixture, with the operator's own figures filled in.
 *
 *   node shoot.mjs <task>       # task-15 | task-16 | task-19 | task-20
 *
 * Not a test. It drives a real Chromium, saves full-page PNGs, and reports the
 * three things a passing Vitest suite has never once caught in this project:
 * horizontal overflow on <body>, console errors, and the measured contrast of
 * text against the pixel actually painted behind it.
 *
 * Each task declares WHERE to go, what proves the screen is ready, what to type,
 * and which text/background pairings to decode off the rendered page. Tasks 15
 * and 16 keep the behaviour they shipped with.
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

/**
 * The selectors whose foreground/background pairing is decoded off the painted
 * pixel. Every one is a FIGURE or a sentence, never a container: a container
 * inherits the body text colour, and measuring it reports a pairing nobody
 * painted.
 */
const FEASIBILITY_CONTRAST = {
  label: ".yd-verdict__label",
  amount: ".yd-verdict__amount",
  gap: ".yd-verdict__gap",
  ratio: ".yd-lever__ratio--exceeded .yd-lever__figure-value",
  ratioNote: ".yd-lever__ratio--exceeded .yd-lever__ratio-note",
  badge: ".yd-lever__badge",
  absent: ".yd-impact__absent",
  leverReason: ".yd-lever__reason",
};

const SIMULATOR_CONTRAST = {
  tabActive: ".yd-sims__tab--active",
  tabIdle: ".yd-sims__tab:not(.yd-sims__tab--active)",
  lead: ".yd-sims__lead",
  link: ".yd-sims__link",
  figureLabel: ".yd-sim__figure-label",
  figureValue: ".yd-sim__figure-value",
  figureNote: ".yd-sim__figure-note",
  assumptions: ".yd-sim__assumptions",
  fieldLabel: ".yd-simfield label",
  fieldHint: ".yd-simfield__hint",
  chartKey: ".yd-chart-key",
  tableHead: ".yd-sim__table thead th",
  tableCell: ".yd-sim__table td",
  negative: ".yd-sim__figure-value--negative",
  consequence: ".yd-sim__consequence",
  refusal: ".yd-sim__refusal",
  ratioAlarm: ".yd-prop__ratio--exceeded .yd-prop__ratio-value",
  verdict: ".yd-prop__verdict-value",
  capped: ".yd-prop__capped",
};

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

const API = process.env.YIELDO_API ?? "http://127.0.0.1:8000/api";

async function api(path, init = {}, token) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  const text = await response.text();
  return text.length > 0 ? JSON.parse(text) : null;
}

/** `page.screenshot`, under this run's task/viewport/theme name. */
function shot(page, viewport, theme, suffix = "") {
  return page.screenshot({
    path: path.join(OUT, `${TASK}-${viewport.name}-${theme}${suffix}.png`),
    fullPage: true,
  });
}

/** Assert a figure really is on screen. The narrow no-break space `formatCents`
 *  emits is normalised first, so an expectation written with a plain space here
 *  still matches what the page actually paints. */
async function expectOnScreen(page, label, ...fragments) {
  const text = await page.evaluate(() =>
    document.body.innerText.replace(/[  ]/g, " "),
  );
  for (const fragment of fragments) {
    if (!text.includes(fragment)) problems.push(`${label}: "${fragment}" is not on screen`);
  }
}

/** The operator's own purchase question, asked on /faisabilite. */
async function askTheOperatorsQuestion(page) {
  await page.getByLabel(/Prix du bien/).fill("40000");
  await page.getByLabel(/Échéance \(mois\)/).fill("12");
  await page.getByRole("button", { name: /Calculer la faisabilité/ }).click();
  await page.waitForSelector("text=Hors de portée", { timeout: 20000 });
  await page.waitForTimeout(700);
}

async function driveFeasibility(page, { theme, viewport, audit }) {
  await page.goto(`${BASE}/faisabilite`);
  await page.waitForSelector("text=Ce que vos relevés mesurent", { timeout: 20000 });

  // Empty state — nothing asked yet.
  await shot(page, viewport, theme, "-vide");
  await askTheOperatorsQuestion(page);

  if (TASK === "task-16") {
    await page.waitForSelector('[data-testid="yd-lever-borrow"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="yd-impact-absent"]', { timeout: 20000 });

    // Two saved questions, created through the UI on the first run only.
    if ((await page.locator('[data-testid^="yd-scenario-"]').count()) < 2) {
      await page.getByLabel(/Nom de ce scénario/).fill("Voiture 40 000 € en 12 mois");
      await page.getByRole("button", { name: /Enregistrer la question/ }).click();
      await page.waitForSelector("text=Voiture 40 000 € en 12 mois", { timeout: 20000 });

      await page.getByLabel(/Prix du bien/).fill("15000");
      await page.getByLabel(/Échéance \(mois\)/).fill("36");
      await page.getByRole("button", { name: /Calculer la faisabilité/ }).click();
      await page.waitForTimeout(900);
      await page.getByLabel(/Nom de ce scénario/).fill("Occasion 15 000 € en 36 mois");
      await page.getByRole("button", { name: /Enregistrer la question/ }).click();
      await page.waitForSelector("text=Occasion 15 000 € en 36 mois", { timeout: 20000 });

      // Back to the operator's own question for the screenshot.
      await askTheOperatorsQuestion(page);
    }
    await page.waitForSelector('[data-testid="yd-scenarios-table"]', { timeout: 20000 });
    await page.waitForTimeout(400);
  }

  await shot(page, viewport, theme);
  await audit("verdict");
}

async function driveSimulators(page, { theme, viewport, audit }) {
  // -- Crédit: the plan's own worked example ---------------------------------
  await page.goto(`${BASE}/simulateurs?onglet=credit`);
  await page.waitForSelector("text=Simuler un crédit", { timeout: 20000 });
  await shot(page, viewport, theme, "-credit-vide");
  await audit("crédit vide");

  await page.getByLabel(/Capital emprunté/).fill("100000");
  await page.getByLabel(/Taux annuel/).fill("3,00");
  await page.getByLabel(/Durée \(mois\)/).fill("240");
  await page.getByRole("button", { name: /Calculer le crédit/ }).click();
  await page.waitForSelector("text=Mensualité", { timeout: 20000 });
  await page.waitForTimeout(900);
  await expectOnScreen(page, `${theme} ${viewport.name} crédit`, "554,60 €", "33 103,24 €");

  // The 240-row table, opened, showing one year and scrolling inside its own box.
  await page.getByRole("button", { name: /Tableau d'amortissement/ }).click();
  await page.waitForSelector('[data-testid="yd-credit-schedule"]', { timeout: 20000 });
  const rowCount = await page.locator('[data-testid="yd-credit-schedule"] tbody tr').count();
  if (rowCount !== 12) {
    problems.push(`${theme} ${viewport.name}: schedule shows ${rowCount} rows, expected 12`);
  }
  const scroller = await page.evaluate(() => {
    const box = document.querySelector(".yd-sim__scroller");
    if (box === null) return null;
    return {
      overflowing: box.scrollWidth > box.clientWidth,
      overflowX: getComputedStyle(box).overflowX,
    };
  });
  if (scroller !== null && scroller.overflowing && scroller.overflowX !== "auto") {
    problems.push(`${theme} ${viewport.name}: the schedule overflows something other than its own scroller`);
  }
  await shot(page, viewport, theme, "-credit");
  await audit("crédit");

  // -- Épargne: 0 € / 100 € per month / 12,00 % / 3 mois ---------------------
  await page.goto(`${BASE}/simulateurs?onglet=epargne`);
  await page.waitForSelector("text=Simuler une épargne", { timeout: 20000 });
  await page.getByLabel(/Montant de départ/).fill("0");
  await page.getByLabel(/Versement mensuel/).fill("100");
  await page.getByLabel(/Taux de rendement annuel/).fill("12,00");
  await page.getByLabel(/Durée \(mois\)/).fill("3");
  await page.getByRole("button", { name: /Calculer l'épargne/ }).click();
  await page.waitForSelector("text=Solde final", { timeout: 20000 });
  await page.waitForTimeout(900);
  await expectOnScreen(page, `${theme} ${viewport.name} épargne`, "303,01 €");

  // -- Épargne with a NEGATIVE contribution. The balance must cross zero on the
  //    chart rather than flatten on it: this is the exact shape ECharts'
  //    `samesign` stacking default destroys, and a picture is the only proof.
  await page.getByLabel(/Montant de départ/).fill("1000");
  await page.getByLabel(/Versement mensuel/).fill("-746,19");
  await page.getByLabel(/Taux de rendement annuel/).fill("3,00");
  await page.getByLabel(/Durée \(mois\)/).fill("6");
  await page.getByRole("button", { name: /Calculer l'épargne/ }).click();
  await page.waitForSelector("text=Ce plan épuise l'épargne", { timeout: 20000 });
  await page.waitForTimeout(1400);
  await expectOnScreen(page, `${theme} ${viewport.name} retrait`, "−3 474,00 €");
  const drawn = await page.evaluate(
    () => document.querySelector('[aria-label*="Évolution du solde"]') !== null,
  );
  if (!drawn) problems.push(`${theme} ${viewport.name}: no savings chart was rendered`);
  await shot(page, viewport, theme, "-epargne");
  await audit("épargne");
}

async function driveProperty(page, { theme, viewport, audit }) {
  await page.goto(`${BASE}/simulateurs?onglet=immobilier`);
  await page.waitForSelector("text=Simuler un achat immobilier", { timeout: 20000 });
  await shot(page, viewport, theme, "-vide");
  await audit("immobilier vide");

  await page.getByLabel(/Prix du bien/).fill("300000");
  await page.getByLabel(/Apport disponible/).fill("60000");
  await page.getByLabel(/Frais de notaire/).selectOption("750");
  await page.getByLabel(/Taux du crédit/).fill("3,50");
  await page.getByLabel(/Durée du crédit/).fill("240");
  await page.getByLabel(/Assurance emprunteur/).fill("0,36");
  await page.getByLabel(/Charges mensuelles/).fill("150");
  await page.getByLabel(/Taxe foncière/).fill("1200");
  await page.getByRole("button", { name: /Calculer l'achat/ }).click();
  await page.waitForSelector("text=Effort mensuel", { timeout: 20000 });
  await page.waitForTimeout(900);
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} immobilier`,
    "22 500,00 €",
    "262 500,00 €",
    "1 522,39 €",
    "78,75 €",
    "1 851,14 €",
    "102 875,23 €",
    // MEASURED against the operator's own 471,11 €/month of income, so 339,87 %
    // and not the 40,03 % the task brief quotes — that figure implies a 4 000 €
    // income this fixture does not have. The alarm is raised either way.
    "339,87 %",
  );

  // The rent comparison.
  await page.getByRole("button", { name: /Comparer avec la location/ }).click();
  await page.getByLabel(/Loyer mensuel/).fill("1100");
  await page.getByLabel(/Horizon de comparaison/).fill("10");
  await page.getByRole("button", { name: /Calculer l'achat/ }).click();
  await page.waitForSelector('[data-testid="yd-prop-comparison"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  await expectOnScreen(page, `${theme} ${viewport.name} location`, "177 582,08 €", "216 287,06 €");
  await shot(page, viewport, theme);
  await audit("immobilier");

  // And the horizon cap: 30 years asked, 240 months answered, with the reason.
  await page.getByLabel(/Horizon de comparaison/).fill("30");
  await page.getByRole("button", { name: /Calculer l'achat/ }).click();
  await page.waitForSelector(".yd-prop__capped", { timeout: 20000 });
  await page.waitForTimeout(700);
  await expectOnScreen(page, `${theme} ${viewport.name} plafond`, "240 mois");
  await shot(page, viewport, theme, "-plafond");
  await audit("plafond");
}

const SCENARIOS = {
  "task-15": { drive: driveFeasibility, contrast: FEASIBILITY_CONTRAST },
  "task-16": { drive: driveFeasibility, contrast: FEASIBILITY_CONTRAST },
  "task-19": { drive: driveSimulators, contrast: SIMULATOR_CONTRAST },
  "task-20": { drive: driveProperty, contrast: SIMULATOR_CONTRAST },
};

const scenario = SCENARIOS[TASK];
if (scenario === undefined) {
  console.error(`Unknown task "${TASK}". One of: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}

// Scenarios persist in the database across the six runs, and the router caps
// them at ten. Cleared once, up front, so every run starts from the same list
// and the save path is exercised exactly once rather than five times over.
if (TASK === "task-16") {
  const { access_token: token } = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "demo@yieldo-demo.fr", password: "MotDePasseDemo123!" }),
  });
  for (const scenario of await api("/feasibility/scenarios", {}, token)) {
    await api(`/feasibility/scenarios/${scenario.id}`, { method: "DELETE" }, token);
  }
  console.log("cleared saved scenarios");
}

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

    // -- The checks a green suite cannot make ---------------------------------
    //
    // Overflow and contrast are properties of ONE rendered state, so they are
    // measured wherever the scenario says a state is worth looking at, not once
    // at the end. Measuring only the last state is how the credit tab's
    // schedule table went unmeasured on the first run of this gate: it is not
    // on screen by the time the épargne tab is.
    async function audit(where) {
      const label = `${theme} ${viewport.name} ${where}`;
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0) problems.push(`${label}: body overflows by ${overflow}px`);

      // Text against the pixel actually behind it, decoded from the DOM's
      // resolved colours rather than from a token value. A selector absent from
      // this state is skipped rather than reported as a pass.
      const contrast = await page.evaluate((targets) => {
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
        for (const [key, selector] of Object.entries(targets)) {
          const el = document.querySelector(selector);
          if (!el) continue;
          out[key] = { fg: parse(getComputedStyle(el).color), bg: opaqueBehind(el) };
        }
        return out;
      }, scenario.contrast);

      for (const [key, pair] of Object.entries(contrast)) {
        const r = ratio(pair.fg, pair.bg);
        const line = `${label} ${key}: ${r.toFixed(2)}:1`;
        if (r < 4.5) problems.push(`AA FAIL ${line}`);
        else notes.push(line);
      }
    }

    await scenario.drive(page, { theme, viewport, audit });

    // The console and the network, on the other hand, accumulate across the
    // whole run and are read once, at the end of it.
    if (consoleErrors.length > 0) {
      problems.push(`${theme} ${viewport.name}: console ${JSON.stringify(consoleErrors)}`);
    }
    if (failed.length > 0) {
      problems.push(`${theme} ${viewport.name}: network ${JSON.stringify(failed)}`);
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
