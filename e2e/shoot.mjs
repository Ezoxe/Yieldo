/**
 * The browser gate: one screen at 375, 768 and 1440 px, in both themes, against
 * the seeded fixture, with the operator's own figures filled in.
 *
 *   node shoot.mjs <task>   # task-15 | task-16 | task-19 | task-20 |
 *                           # task-2c | task-2c-jalons |
 *                           # task-10 | task-10-positions |
 *                           # task-10-formulaires
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
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const TASK = process.argv[2] ?? "task-15";
const BASE = process.env.YIELDO_URL ?? "http://localhost:5173";
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Each phase keeps its own screenshot folder, so a re-run of an older task
// never overwrites the evidence a newer one was reviewed on.
const OUT_DIRS = {
  "phase-2b": path.resolve(HERE, "../.superpowers/sdd/2026-08-24-yieldo-phase-2b-decision/screenshots"),
  "phase-2c": path.resolve(HERE, "../.superpowers/sdd/2026-09-01-yieldo-phase-2c-engagement/screenshots"),
  "phase-3": path.resolve(HERE, "../.superpowers/sdd/2026-09-01-yieldo-phase-3-patrimoine/screenshots"),
};
const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
];
const THEMES = ["dark", "light"];

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
  itemLabel: ".yd-purchase__group label",
  itemNote: ".yd-purchase__note",
  ownNote: ".yd-own__note",
  burn: '[data-testid="yd-impact-burn"]',
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

/**
 * /suivi. Every selector below is a FIGURE, a sentence or a control — never a
 * container.
 *
 * Three of them exist because of what this screen has to keep apart: the
 * measured score (`healthScore`), the numeral of a component measured at ZERO
 * (`compScore`), and the band standing in for a component that could not be
 * measured at all (`compAbsent`). The last two must clear AA on their own,
 * because the only thing telling them apart is what they are made of.
 *
 * `monthCovered` / `monthMissing` are the two-digit numerals INSIDE the streak
 * cells: the covered one is ink painted on the accent fill, which is the one
 * pairing on this screen whose ground is not the card.
 */
const SUIVI_CONTRAST = {
  lead: ".yd-suivi__lead",
  note: ".yd-suivi__note",
  refusal: ".yd-suivi__refusal",
  key: ".yd-suivi__key",
  streakCount: ".yd-streak__count",
  streakUnit: ".yd-streak__unit",
  monthCovered: ".yd-streak__month--covered .yd-streak__month-num",
  monthEmpty: ".yd-streak__month--empty .yd-streak__month-num",
  monthMissing: ".yd-streak__month--missing .yd-streak__month-num",
  healthScore: ".yd-health__score",
  healthScale: ".yd-health__scale",
  healthBasis: ".yd-health__basis",
  compLabel: ".yd-hcomp__label",
  compWeight: ".yd-hcomp__weight",
  compScore: ".yd-hcomp__score",
  compValue: ".yd-hcomp__value",
  compAbsent: ".yd-hcomp__absent-band",
  challengeTitle: ".yd-challenge__title",
  challengeFigureLabel: ".yd-challenge__figure-label",
  challengeFigureValue: ".yd-challenge__figure-value",
  challengeDetail: ".yd-challenge__detail",
  challengeAction: ".yd-challenge__action",
  challengeState: ".yd-challenge__state",
  challengeOutcome: ".yd-challenge__outcome",
  emptyTitle: ".yd-empty__title",
  emptyDetail: ".yd-empty__detail",
  jalonPercent: ".yd-jalon__percent",
  jalonThreshold: ".yd-jalon__threshold",
  jalonWhen: ".yd-jalon--reached .yd-jalon__when",
  jalonCount: ".yd-jalons__count",
};

/**
 * /patrimoine. Every selector below is a FIGURE, a sentence or a state — never
 * a container.
 *
 * Four of them exist because of the distinction this whole screen is built to
 * make. `holdingPrice` is a price that was fetched; `holdingStale` is the age
 * carried beside a price that is real but old; `holdingAbsent` is the band
 * standing in for a price that does not exist at all; and `holdingReason` is
 * the French cause naming which of five things went wrong. The last two must
 * clear AA on their own — they sit on a hatched ground, which is the one
 * pairing on this screen whose background is not the flat card.
 *
 * `providerUnset` is the same problem on the market panel: "Aucune clé" is
 * painted on a transparent, dashed cell rather than on the surface every other
 * provider row uses.
 */
const PATRIMOINE_CONTRAST = {
  lead: ".yd-patrimoine__lead",
  note: ".yd-patrimoine__note",
  refusal: ".yd-patrimoine__refusal",
  link: ".yd-patrimoine__link",
  emptyTitle: ".yd-empty__title",
  emptyDetail: ".yd-empty__detail",
  steps: ".yd-patrimoine__steps",
  totalLabel: ".yd-ptotal__label",
  totalAmount: ".yd-ptotal__amount",
  totalCurrency: ".yd-ptotal__currency",
  completeness: ".yd-ptotal__completeness",
  rowLabel: ".yd-ptotal__row-label",
  rowValue: ".yd-ptotal__row-value",
  tableHead: ".yd-holdings__table thead th",
  holdingSymbol: ".yd-holding__symbol",
  holdingName: ".yd-holding__name",
  holdingQuantity: ".yd-holding__quantity",
  holdingPrice: ".yd-holding__price-value",
  holdingAsOf: ".yd-holding__asof",
  holdingStale: ".yd-holding__stale",
  holdingAbsent: ".yd-holding__absent-band",
  holdingReason: ".yd-holding__reason",
  holdingValue: ".yd-holding__value",
  holdingGain: ".yd-holding__gain",
  providerName: ".yd-provider__name",
  providerRole: ".yd-provider__role",
  providerQuota: ".yd-provider__quota",
  providerUnset: ".yd-provider--unset .yd-provider__state",
  providerSet: ".yd-provider__state--set",
  weightLabel: ".yd-weight__label",
  weightPercent: ".yd-weight__percent",
  weightAmount: ".yd-weight__amount",
  allocBasis: ".yd-alloc__basis",
  allocSection: ".yd-alloc__section-title",
  driftLabel: ".yd-drift__label",
  driftCurrent: ".yd-drift__current",
  driftTarget: ".yd-drift__target",
  driftGap: ".yd-drift__gap",
  tradeAction: ".yd-trade__action",
  tradeQuantity: ".yd-trade__quantity",
  tradeValue: ".yd-trade__value",
  // The declaration panel and its four forms (task-10-formulaires). A label,
  // a hint and an error are three different registers on the same surface and
  // each has to clear AA on its own — the hint is the one that says what an
  // undated PEA costs, and it is the smallest text on the screen.
  accountName: ".yd-eaccount__name",
  accountMeta: ".yd-eaccount__meta",
  positionSymbol: ".yd-eposition__symbol",
  positionQuantity: ".yd-eposition__quantity",
  positionBasis: ".yd-eposition__basis",
  positionEmpty: ".yd-eposition__empty",
  lotQuantity: ".yd-elot__quantity",
  lotCost: ".yd-elot__cost",
  lotDate: ".yd-elot__date",
  editorAction: ".yd-editor__action",
  editorAdd: ".yd-editor__add",
  confirmQuestion: ".yd-editor__confirm-question",
  formLabel: ".yd-pform__field label",
  formHint: ".yd-pform__hint",
  formNote: ".yd-pform__note",
  formError: ".yd-pform__error",
  formDerived: ".yd-pform__derived",
  formSave: ".yd-pform__save",
  formCancel: ".yd-pform__cancel",
  targetsSum: ".yd-targets-form__sum",
  targetsRemove: ".yd-targets-form__remove",
  targetsAdd: ".yd-targets-form__add",
  allocEdit: ".yd-alloc__edit",
};

/**
 * /projection. Every selector below is a FIGURE, a sentence or a control —
 * never a container.
 *
 * Four of them exist because of the distinction this screen is built to make.
 * `refusal` is an engine declining to answer, and on the operator's own data it
 * is four fifths of the page — it has to be as readable as any figure.
 * `mcBandNegative` is a percentile that went below zero: painted in the
 * negative tone, on the card surface, and it must clear AA on its own or the
 * one number the band exists to show is the least legible on screen.
 * `shockBadge` is the sentence that stops a stressed euro amount being read as
 * a forecast. `shockAbsent` is the hatched band standing in for a class an
 * episode has no data for — an absence, on a hatched ground, which is the one
 * pairing here whose background is not the flat card.
 */
const PROJECTION_CONTRAST = {
  lead: ".yd-projection__lead",
  note: ".yd-projection__note",
  refusal: ".yd-projection__refusal",
  link: ".yd-projection__link",
  sectionTitle: ".yd-projection__section-title",
  seedLabel: ".yd-assumptions__seed-label",
  seedValue: ".yd-assumptions__seed-value",
  seedNote: ".yd-assumptions__seed-note",
  reseed: ".yd-assumptions__reseed",
  toggle: ".yd-assumptions__toggle",
  factLabel: ".yd-fact__label",
  factValue: ".yd-fact__value",
  factNote: ".yd-fact__note",
  factWords: ".yd-fact__value--words",
  negativeFigure: ".yd-projection__figure--negative",
  formLabel: ".yd-assumptions__field label",
  formInput: ".yd-assumptions__field input",
  formHint: ".yd-assumptions__hint",
  formError: ".yd-assumptions__error",
  apply: ".yd-assumptions__apply",
  fireTargetLabel: ".yd-fire__target-label",
  fireTargetValue: ".yd-fire__target-value",
  fireTimelineValue: ".yd-fire__timeline-value",
  fireRowLabel: ".yd-fire__row-label",
  fireRowValue: ".yd-fire__row-value",
  fireRowNote: ".yd-fire__row-note",
  mcBandLabel: ".yd-mc__band-label",
  mcBandValue: ".yd-mc__band-value",
  mcBandNegative: ".yd-mc__band-value--negative",
  mcBandNote: ".yd-mc__band-note",
  chartKey: ".yd-chart-key",
  taxTotalLabel: ".yd-tax__total-label",
  taxTotalValue: ".yd-tax__total-value",
  envName: ".yd-tenv__name",
  envKind: ".yd-tenv__kind",
  envRegime: ".yd-tenv__regime",
  envAltTitle: ".yd-tenv__alternative-title",
  figLabel: ".yd-tfig__label",
  figValue: ".yd-tfig__value",
  shockLabel: ".yd-shock__label",
  shockBadge: ".yd-shock__badge",
  shockPeriod: ".yd-shock__period",
  shockSource: ".yd-shock__source",
  shockHeadlineLabel: ".yd-shock__headline-label",
  shockHeadlineValue: ".yd-shock__headline-value",
  shockHeadlineNote: ".yd-shock__headline-note",
  shockRateLabel: ".yd-shock__rate-label",
  shockRateValue: ".yd-shock__rate-value",
  shockRateNegative: ".yd-shock__rate-value--negative",
  shockRatePositive: ".yd-shock__rate-value--positive",
  shockCaption: ".yd-shock__caption",
  shockTableHead: ".yd-shock__table thead th",
  shockTableCell: ".yd-shock__table td",
  shockAbsent: ".yd-shock__absent-band",
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

/** Where this run's PNGs land. Assigned once the task's scenario is resolved,
 *  below — every task keeps its own phase's folder. */
let OUT;

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

  // The running-cost items, prefilled from the nature's French averages and
  // EDITED here -- design §6.3 item 3's "ajustables". The panel below has to
  // answer with the edited figure, not with the default it started from.
  await page.getByRole("button", { name: /Postes de fonctionnement/ }).click();
  await page.getByLabel(/Carburant/).fill("180,50");
  await page.getByRole("button", { name: /Calculer la faisabilité/ }).click();
  await page.waitForSelector("text=Hors de portée", { timeout: 20000 });
  await page.waitForTimeout(900);
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} postes`,
    // 180,50 EUR a month over five years: 10 830,00 EUR, and 180,50 EUR as the
    // monthly average. The default of 130,00 EUR would have given 7 800,00 EUR.
    "10 830,00 €",
    // And the runway now names the rate it divides by (design §10).
    "2 654,49 € par mois",
  );
  await shot(page, viewport, theme, "-postes");
  await audit("postes");
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

/**
 * /suivi, on the operator's own 197 transactions.
 *
 * Every figure asserted below was measured live off `GET /api/engagement`
 * before this screen was written, so a change that quietly stops printing one
 * of them fails here rather than looking fine.
 */
async function driveSuivi(page, { theme, viewport, audit }) {
  await page.goto(`${BASE}/suivi`);
  await page.waitForSelector("text=Régularité du suivi", { timeout: 20000 });
  await page.waitForSelector('[data-testid="yd-streak-strip"]', { timeout: 20000 });

  await expectOnScreen(
    page,
    `${theme} ${viewport.name} suivi`,
    // The streak, broken for seven months — the engine's sentence, verbatim.
    "cela fait 7 mois qu'aucun relevé n'a été importé",
    "Votre plus longue série : 13 mois",
    "Dernier mois importé : janvier 2026",
    // The health score: MEASURED at zero, from three components out of four.
    "Mesuré à partir de 3 composantes sur 4",
    "80 % du barème",
    // Each measured component in its OWN unit, not three identical zeroes.
    "−158,39 % du revenu médian",
    "266,28 % du revenu médian",
    "0,0 mois de dépenses essentielles",
    // And the fourth as an absence, with the engine's own reason.
    "Non mesurée",
    "Aucun budget n'a encore été suivi sur un mois complet",
    "Ses 20 % ont été répartis sur les composantes mesurées",
    // The single challenge, with the label that says what its figure measured.
    "Écart avec l'habitude de la catégorie",
    "168,14 €",
    "mesuré sur 17 opérations",
  );

  // A measured 0 is a figure; a score that could not be calculated is a
  // sentence. His score WAS measured, so the words must not be on screen.
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("Non calculable")) {
    problems.push(`${theme} ${viewport.name}: a measured score of 0 is showing as "Non calculable"`);
  }

  // Three meters and exactly three, whatever the theme does to the fill.
  const meters = await page.evaluate(() => document.querySelectorAll('[role="meter"]').length);
  if (meters !== 3) {
    problems.push(`${theme} ${viewport.name}: ${meters} gauges drawn, expected 3`);
  }

  // The zero-score fill must be zero-WIDTH and its track must still be
  // visible: a percentage width in an auto-width column resolves to nothing,
  // and a track that vanished would make a measured 0 indistinguishable from
  // an absence. Both halves are measured off the rendered box.
  const gauge = await page.evaluate(() => {
    const track = document.querySelector('[data-testid="yd-hcomp-fill-savings_rate"]')
      ?.parentElement;
    const fill = document.querySelector('[data-testid="yd-hcomp-fill-savings_rate"]');
    if (!track || !fill) return null;
    return { trackWidth: track.getBoundingClientRect().width, fillWidth: fill.getBoundingClientRect().width };
  });
  if (gauge === null) problems.push(`${theme} ${viewport.name}: no savings-rate gauge on screen`);
  else if (gauge.trackWidth < 40) {
    problems.push(`${theme} ${viewport.name}: gauge track collapsed to ${gauge.trackWidth}px`);
  } else if (gauge.fillWidth > 1) {
    problems.push(`${theme} ${viewport.name}: a score of 0 drew a ${gauge.fillWidth}px fill`);
  }

  if (TASK === "task-2c-jalons") {
    // The challenge is accepted THROUGH THE UI the first time this pass runs;
    // afterwards it has left the `proposed` state for good, and every later
    // combination photographs the accepted card and its outcome refusal.
    const accept = page.getByRole("button", { name: /Accepter le défi/ });
    if ((await accept.count()) > 0) {
      await accept.first().click();
    }
    await page.waitForSelector("text=Pas assez de temps écoulé", { timeout: 20000 });
    await expectOnScreen(
      page,
      `${theme} ${viewport.name} défi accepté`,
      "Accepté le",
      // The four refusals are four different waits, and this is the one that
      // applies the day a challenge is accepted.
      "le résultat n'est mesurable qu'une fois le mois suivant entièrement terminé",
    );
    await expectOnScreen(
      page,
      `${theme} ${viewport.name} jalons`,
      "1 jalon franchi sur 4",
      "Atteint",
      "Non projeté",
      "aucun objectif ne progresse",
    );
    // A reached milestone carries NO date: `saved_cents` is declared with no
    // history behind it, so Yieldo does not know when the threshold was
    // crossed. "Atteint aujourd'hui" is the sentence this asserts is absent —
    // read AFTER the goal's own card is on screen, not from the earlier
    // snapshot of the page taken before the accept.
    const withGoal = await page.evaluate(() => document.body.innerText);
    if (/Atteint\s+(aujourd'hui|le\b)/.test(withGoal)) {
      problems.push(`${theme} ${viewport.name}: a reached milestone carries a date`);
    }
  } else {
    await expectOnScreen(
      page,
      `${theme} ${viewport.name} sans objectif`,
      "Aucun objectif déclaré",
      // One stored snapshot is not a history, and no curve is drawn through it.
      "Un seul relevé pour l'instant",
    );
    const canvas = await page.evaluate(
      () => document.querySelector('[aria-label*="relevés du score"]') !== null,
    );
    if (canvas) {
      problems.push(`${theme} ${viewport.name}: a curve was drawn through a single reading`);
    }
  }

  await page.waitForTimeout(700);
  await shot(page, viewport, theme);
  await audit("suivi");
}

/**
 * /patrimoine, in the two states that matter.
 *
 * `task-10` is the operator's ACTUAL state: zero positions, no key registered,
 * no target allocation. That is the screen's most-read state and the one this
 * gate exists to photograph honestly.
 *
 * `task-10-positions` is the same screen after three holdings have been
 * declared through the real API (see the seeding block at the bottom of this
 * file), one of which deliberately cannot be priced. Both are driven by this
 * one function: the screen is the same, only the data differs, and a second
 * drive function would let the two drift apart.
 */
async function drivePatrimoine(page, { theme, viewport, audit }) {
  await page.goto(`${BASE}/patrimoine`);
  await page.waitForSelector("text=Ce que vous détenez", { timeout: 20000 });

  if (TASK === "task-10") {
    await page.waitForSelector('[data-testid="yd-market-no-key"]', { timeout: 20000 });
    await expectOnScreen(
      page,
      `${theme} ${viewport.name} patrimoine vide`,
      // The empty state DIAGNOSES rather than showing a hero zero.
      "Aucune position déclarée.",
      "Un compte d'investissement",
      "Un lot par acquisition",
      // No key, said as itself — not as a price that went missing.
      "Aucune clé n'est enregistrée pour l'instant",
      "fonctionne sans aucune clé",
      // Two providers need no key at all; saying otherwise would invent a
      // remedy for something that is not a problem.
      "Aucune clé requise",
      // And no target allocation, as a refusal rather than a table of zeroes.
      "Aucune allocation cible n'est définie",
    );

    // A hero "0,00 €" is exactly what this state must NOT show.
    const body = await page.evaluate(() =>
      document.body.innerText.replace(/[  ]/g, " "),
    );
    if (body.includes("0,00 €")) {
      problems.push(`${theme} ${viewport.name}: an empty portfolio is showing a 0,00 € figure`);
    }
    // The four causes that did NOT happen must not be on screen. Matched on
    // each cause's own SENTENCE from market/client.py, not on a keyword: the
    // bare word "symbole" is legitimate French this screen uses to explain
    // what an instrument is, and matching it flagged that copy as a defect.
    const wrongCauses = [
      "a été refusée par le fournisseur",
      "est épuisé pour cette période",
      "est injoignable pour le moment",
      "est inconnu de",
    ];
    for (const wrong of wrongCauses) {
      if (body.includes(wrong)) {
        problems.push(`${theme} ${viewport.name}: empty state names the wrong cause "${wrong}"`);
      }
    }
  } else {
    await page.waitForSelector('[data-testid="yd-holdings-table"]', { timeout: 20000 });
    await expectOnScreen(
      page,
      `${theme} ${viewport.name} patrimoine garni`,
      // The total NEVER without its completeness count.
      "positions valorisées sur 3",
      "un plancher, pas la valeur du portefeuille",
      // A missing price, as an absence with its own cause named.
      "Prix indisponible",
      "Aucune clé n'est enregistrée pour Finnhub",
      // Weights are over what could be valued, and say so.
      "calculées sur ce qui a pu être valorisé",
      // A stale price is COUNTED, and carries its age rather than a failure.
      "Prix daté du",
      // Both halves of the allocation answer: an order it could size, and a
      // refusal where it could not. A run showing only one photographs half
      // the panel.
      "Ordres qui refermeraient l'écart",
      "Écarts qu'aucun ordre ne peut refermer",
      "n'est pas fractionnable",
      "moins d'une unité au prix actuel",
    );

    // The three states must be three DIFFERENT things on the rendered page,
    // not three labels that happen to differ in the DOM.
    const shapes = await page.evaluate(() => ({
      absent: document.querySelectorAll(".yd-holding__absent-band").length,
      stale: document.querySelectorAll(".yd-holding__stale").length,
      priced: document.querySelectorAll(".yd-holding__price-value").length,
      reasons: document.querySelectorAll(".yd-holding__reason").length,
    }));
    if (shapes.absent < 1) {
      problems.push(`${theme} ${viewport.name}: no missing-price band drawn`);
    }
    if (shapes.reasons < 1) {
      problems.push(`${theme} ${viewport.name}: a missing price carries no cause`);
    }
    // A stale price still shows a FIGURE — that is what separates it from a
    // missing one. If every priced cell vanished, the two collapsed together.
    if (shapes.priced < 1) {
      problems.push(`${theme} ${viewport.name}: no price figure on any row`);
    }

    // A quantity must never have gone through a money formatter: 0,25 BTC
    // through formatCents reads "0,00 €", and 12 shares reads as 12 cents.
    const quantities = await page.evaluate(() =>
      [...document.querySelectorAll(".yd-holding__quantity, .yd-trade__quantity")].map(
        (el) => el.textContent ?? "",
      ),
    );
    for (const text of quantities) {
      if (text.includes("€")) {
        problems.push(`${theme} ${viewport.name}: a quantity rendered with a currency: "${text}"`);
      }
    }
    // The cash holding is 2 500 units. Through `formatCents` that reads
    // "25,00 €"; through `formatQuantity` it reads "2 500" with no currency,
    // which is what must be on screen. The narrow no-break space is
    // normalised to a plain one, like every other expectation in this file.
    const normalised = quantities.map((t) => t.replace(/[\u202f\u00a0]/g, " "));
    if (!normalised.some((t) => t.trim() === "2 500")) {
      problems.push(
        `${theme} ${viewport.name}: the 2 500-unit cash holding is not on screen as "2 500" (got ${JSON.stringify(normalised)})`,
      );
    }
  }

  // Every gauge on this screen is a real scale with a real track. A percentage
  // width in an auto-width flex column resolves to ZERO, which would make a
  // small share indistinguishable from an absent one.
  const tracks = await page.evaluate(() =>
    [...document.querySelectorAll(".yd-weight__track, .yd-drift__track")].map((el) => ({
      width: el.getBoundingClientRect().width,
    })),
  );
  for (const track of tracks) {
    if (track.width < 40) {
      problems.push(`${theme} ${viewport.name}: a gauge track collapsed to ${track.width}px`);
    }
  }

  // The holdings table is wide by nature. It must scroll inside its OWN box
  // rather than push the page sideways — the rule since the credit schedule.
  const scroller = await page.evaluate(() => {
    const box = document.querySelector(".yd-holdings__scroller");
    if (box === null) return null;
    return {
      overflowing: box.scrollWidth > box.clientWidth,
      overflowX: getComputedStyle(box).overflowX,
    };
  });
  if (scroller !== null && scroller.overflowing && scroller.overflowX !== "auto") {
    problems.push(
      `${theme} ${viewport.name}: the holdings table overflows something other than its own scroller`,
    );
  }

  await page.waitForTimeout(700);
  await shot(page, viewport, theme);
  await audit("patrimoine");
}

/**
 * /patrimoine's four declaration forms, open and filled, and the two states a
 * passing Vitest suite says nothing about: what a filled form LOOKS like at
 * 375 px in both themes, and what a refusal looks like beside the field that
 * produced it.
 *
 * The account, the position and the first lot are created THROUGH THE FORMS,
 * on the first combination only — that is the whole point of this target: the
 * screen shipped read-only, and a browser that can drive it end to end is the
 * only proof it no longer is. The five combinations afterwards photograph the
 * same three states against the data the first one declared.
 *
 * Nothing inside the loop mutates: the account form is cancelled, the lot form
 * is cancelled, and the target set is deliberately left summing to 90 % so the
 * refusal is what gets photographed. So the six runs are identical in effect.
 */
async function drivePatrimoineForms(page, { theme, viewport, audit }) {
  await page.goto(`${BASE}/patrimoine`);
  await page.waitForSelector("text=Déclarer ce que vous détenez", { timeout: 20000 });

  // -- First run only: declare the three things, through the real forms ------
  if ((await page.locator(".yd-eaccount").count()) === 0) {
    await page.getByRole("button", { name: /Ajouter un compte d'investissement/ }).click();
    await page.getByLabel(/Nom du compte/).fill("PEA Boursorama");
    await page.getByLabel(/Type d'enveloppe/).selectOption("pea");
    await page.getByLabel(/Date d'ouverture/).fill("2019-04-01");
    await page.getByRole("button", { name: /^Enregistrer$/ }).click();
    await page.waitForSelector(".yd-eaccount", { timeout: 20000 });

    await page.getByRole("button", { name: /Déclarer une position/ }).click();
    await page.getByLabel(/Symbole coté/).fill("AAPL");
    await page.getByLabel(/Nom de l'instrument/).fill("Apple Inc.");
    await page.getByRole("button", { name: /^Enregistrer$/ }).click();
    await page.waitForSelector(".yd-eposition", { timeout: 20000 });

    await page.getByRole("button", { name: /Ajouter un lot/ }).click();
    await page.getByLabel(/Quantité acquise/).fill("12");
    await page.getByLabel(/Prix unitaire payé/).fill("150,00");
    await page.getByLabel(/Date d'acquisition/).fill("2026-01-15");
    await page.getByRole("button", { name: /^Enregistrer$/ }).click();
    await page.waitForSelector(".yd-elot", { timeout: 20000 });
    console.log("declared an account, a position and a lot through the forms");
  }

  // The panel at rest: the derived total and the count it came from, together.
  await page.waitForSelector(".yd-eposition__derived", { timeout: 20000 });
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} panneau`,
    "PEA Boursorama",
    "ouvert le 1er avril 2019",
    // A position stores no total: the figure and its provenance travel together.
    "somme de 1 lot",
    "150,00 € l'unité",
  );
  await shot(page, viewport, theme, "-panneau");
  await audit("panneau");

  // -- The account form, open and filled -------------------------------------
  await page.getByRole("button", { name: /Ajouter un compte d'investissement/ }).click();
  await page.getByLabel(/Nom du compte/).fill("Assurance-vie Linxea");
  await page.getByLabel(/Type d'enveloppe/).selectOption("assurance_vie");
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} compte`,
    // An undated contract costs a tax rule, and the form says which — as a
    // consequence, not as a refusal: it still saves.
    "l'abattement au bout de 8 ans ne pourra pas être appliqué à ce contrat",
  );
  await page.waitForTimeout(300);
  await shot(page, viewport, theme, "-compte");
  await audit("compte");
  await page.getByRole("button", { name: /Annuler/ }).click();

  // -- The lot form, open and filled: the derived total, before it is saved ---
  await page.getByRole("button", { name: /Ajouter un lot/ }).click();
  await page.getByLabel(/Quantité acquise/).fill("0,25");
  await page.getByLabel(/Prix unitaire payé/).fill("1 250,50");
  await page.getByLabel(/Date d'acquisition/).fill("2026-03-04");
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} lot`,
    "Après enregistrement, AAPL comptera 2 lots, soit 12,25 unités au total.",
    "Yieldo ne stocke jamais ce total",
  );
  await page.waitForTimeout(300);
  await shot(page, viewport, theme, "-lot");
  await audit("lot");

  // -- The refusal, at the field that produced it ----------------------------
  // Nineteen decimals: engines/quantity.py refuses more than eighteen rather
  // than rounding one away, and the form has to say so in French rather than
  // truncating silently.
  await page.getByLabel(/Quantité acquise/).fill("0,0000000000000000019");
  await page.getByRole("button", { name: /^Enregistrer$/ }).click();
  await page.waitForSelector(".yd-pform__error", { timeout: 20000 });
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} refus quantité`,
    "Quantité trop précise : 19 décimales ont été saisies et Yieldo n'en conserve que 18. Aucune décimale n'est arrondie en silence : retirez-en 1.",
    "Le total ne peut pas être calculé tant que la quantité saisie n'est pas lisible.",
  );
  const invalid = await page.evaluate(
    () => document.querySelectorAll('.yd-pform [aria-invalid="true"]').length,
  );
  if (invalid !== 1) {
    problems.push(
      `${theme} ${viewport.name}: ${invalid} fields marked invalid, expected exactly the quantity`,
    );
  }
  await page.waitForTimeout(300);
  await shot(page, viewport, theme, "-refus");
  await audit("refus");
  await page.getByRole("button", { name: /Annuler/ }).click();

  // -- The target set, refused for summing to 90 % ---------------------------
  await page.getByRole("button", { name: /allocation cible/ }).click();
  await page.waitForSelector(".yd-targets-form__rows", { timeout: 20000 });
  while ((await page.locator(".yd-targets-form__row").count()) < 2) {
    await page.getByRole("button", { name: /Ajouter une classe/ }).click();
  }
  const shares = page.getByLabel(/Part visée/);
  await shares.nth(0).fill("60");
  await shares.nth(1).fill("30");
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} somme`,
    "Somme des parts visées : 90,00 % — il manque 10,00 %.",
  );
  await page.getByRole("button", { name: /^Enregistrer$/ }).click();
  await page.waitForSelector(".yd-pform__error--form", { timeout: 20000 });
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} refus cible`,
    "La somme des parts visées fait 90,00 %, alors qu'elle doit faire exactement 100,00 %. Ajoutez les 10,00 % manquants avant d'enregistrer.",
  );
  await page.waitForTimeout(400);
  await shot(page, viewport, theme, "-cible");
  await audit("cible");
}

/**
 * /projection, in the two states that matter.
 *
 * `task-16-projection` is the operator's ACTUAL state: zero positions, a
 * measured savings capacity of −746,19 €/month. All four engines refuse, each
 * for its own reason and each naming its own remedy — that is four fifths of
 * the page, and it is the state he opens every day.
 *
 * `task-16-projection-garni` is the same screen with three holdings behind it
 * (see the seeding block at the bottom of this file), so the fan chart, the
 * FIRE timeline, three different tax regimes and the three stress scenarios are
 * all on screen at once. Both are driven by this one function: the screen is
 * the same, only the data differs, and a second drive function would let the
 * two drift apart.
 *
 * The seed is pinned in the URL rather than left to the page's own first pick,
 * so the six combinations photograph the SAME run — six different bands would
 * make the screenshots useless as evidence.
 */
const PROJECTION_SEED = 424242;

async function driveProjection(page, { theme, viewport, audit }) {
  const populated = TASK === "task-16-projection-garni";
  // 120 months on the populated run: long enough for the operator's negative
  // capacity to take the band through zero, short enough for the crossing to
  // be visible at 375 px. `tmi=3000` prices the barème beside the PFU.
  const query = populated
    ? `?graine=${PROJECTION_SEED}&horizon=120&trajectoires=400&tmi=3000`
    : `?graine=${PROJECTION_SEED}&trajectoires=400`;
  await page.goto(`${BASE}/projection${query}`);
  await page.waitForSelector("text=Hypothèses de ce calcul", { timeout: 30000 });
  await page.waitForSelector(".yd-assumptions__seed-value", { timeout: 30000 });

  // The seed is on screen as a numeral, and it is the one that was asked for.
  const seedOnScreen = await page.textContent(".yd-assumptions__seed-value");
  if (seedOnScreen.trim() !== String(PROJECTION_SEED)) {
    problems.push(
      `${theme} ${viewport.name}: the seed on screen is "${seedOnScreen}", expected ${PROJECTION_SEED}`,
    );
  }

  if (!populated) {
    await page.waitForSelector('[data-testid="yd-mc-refusal"]', { timeout: 30000 });
    await expectOnScreen(
      page,
      `${theme} ${viewport.name} projection vide`,
      // Four engines, four DIFFERENT causes, four different remedies.
      "Aucun capital de départ : vous ne détenez aucune position",
      "l'indépendance financière ne se rapproche pas, elle recule ou stagne",
      "Aucune plus-value latente à imposer",
      "Aucune classe d'actifs à soumettre à un choc",
      // The measured capacity, with its sign intact — never abs(), never 0.
      "−746,19 €",
      // A refusal on the timeline is not a refusal on everything: the expense
      // rate IS measured (2 654,49 €/month over his three complete months), so
      // the capital the 4 % rule implies is a real figure.
      "796 347,00 €",
      // The three episodes stay named, with their periods and their sources,
      // even though nothing could be applied to them. The badge itself is
      // asserted off the DOM below rather than as text: it is uppercased in
      // CSS, and `innerText` reports what is PAINTED, not what was written.
      "Crise financière de 2008",
      "octobre 2007 - mars 2009",
    );

    const emptyCards = await page.evaluate(() => ({
      badges: document.querySelectorAll(".yd-shock__badge").length,
      periods: document.querySelectorAll(".yd-shock__period").length,
      sources: document.querySelectorAll(".yd-shock__source").length,
    }));
    if (emptyCards.badges !== 3 || emptyCards.periods !== 3 || emptyCards.sources !== 3) {
      problems.push(
        `${theme} ${viewport.name}: refused stress cards carry ${emptyCards.badges} badges / ${emptyCards.periods} periods / ${emptyCards.sources} sources, expected 3 each`,
      );
    }

    // The four refusals must be four DIFFERENT sentences on the rendered page.
    const refusals = await page.evaluate(() =>
      [...document.querySelectorAll(".yd-projection__refusal")].map((el) => el.textContent.trim()),
    );
    if (refusals.length < 4) {
      problems.push(`${theme} ${viewport.name}: ${refusals.length} refusals on screen, expected 4`);
    }
    if (new Set(refusals).size !== refusals.length) {
      problems.push(`${theme} ${viewport.name}: two panels are printing the SAME refusal sentence`);
    }
    // And no fan chart at all: a band drawn from 0 € would be a line, and a
    // line is not a measurement of risk.
    const drawn = await page.evaluate(
      () => document.querySelector('[aria-label*="Projection Monte Carlo"]') !== null,
    );
    if (drawn) {
      problems.push(`${theme} ${viewport.name}: a fan chart was drawn on an empty portfolio`);
    }
  } else {
    await page.waitForSelector(".yd-mc__bands", { timeout: 30000 });
    await page.waitForTimeout(1200);
    await expectOnScreen(
      page,
      `${theme} ${viewport.name} projection garnie`,
      // Every tax figure names the regime that produced it, with its article.
      "PEA exonéré d'impôt sur le revenu (art. 157, 5° bis CGI)",
      "PFU — prélèvement forfaitaire unique, 30 %",
      "Barème progressif de l'impôt sur le revenu",
      // Each stress scenario carries its own period; the badge that marks it a
      // measured past is asserted off the DOM below (it is uppercased in CSS).
      "année civile 2022",
      // Bitcoin did not exist in 2008: named as an absence, never a 0 %.
      "Aucune donnée",
    );

    // The band is three centiles and never one number. Read off the DOM, not
    // off innerText: these labels are uppercased in CSS, and `innerText`
    // reports what is PAINTED rather than what was written — a difference no
    // jsdom test can see, and one this gate found.
    const bandLabels = await page.evaluate(() =>
      [...document.querySelectorAll(".yd-mc__band-label")].map((el) => el.textContent.trim()),
    );
    for (const expected of ["Pire dixième (P10)", "Médiane (P50)", "Meilleur dixième (P90)"]) {
      if (!bandLabels.includes(expected)) {
        problems.push(
          `${theme} ${viewport.name}: the band tile "${expected}" is not on screen (got ${JSON.stringify(bandLabels)})`,
        );
      }
    }

    // The fan chart exists, and its key is HTML above the canvas.
    const chart = await page.evaluate(() => ({
      drawn: document.querySelector('[aria-label*="Projection Monte Carlo"]') !== null,
      key: document.querySelectorAll(".yd-chart-key__item").length,
      label:
        document.querySelector('[aria-label*="Projection Monte Carlo"]')?.getAttribute("aria-label") ??
        "",
    }));
    if (!chart.drawn) problems.push(`${theme} ${viewport.name}: no fan chart was rendered`);
    if (chart.key < 2) {
      problems.push(`${theme} ${viewport.name}: the chart key has ${chart.key} entries, expected 2+`);
    }
    if (!chart.label.includes(`graine ${PROJECTION_SEED}`)) {
      problems.push(`${theme} ${viewport.name}: the chart's own label does not name the seed`);
    }
    // The whole point: the lower percentile went below zero and stayed there.
    // A band clamped at 0 is the phase-2A defect this screen exists not to
    // repeat, and a picture is the only proof.
    const negative = await page.evaluate(
      () => document.querySelectorAll(".yd-mc__band-value--negative").length,
    );
    if (negative < 1) {
      problems.push(
        `${theme} ${viewport.name}: no negative percentile on screen — the band may have been clamped at zero`,
      );
    }
    if (!chart.label.includes("passe sous zéro")) {
      problems.push(`${theme} ${viewport.name}: the chart's label does not report the zero crossing`);
    }

    // The three stress cards, each with its own period and its own source.
    const cards = await page.evaluate(() => ({
      badges: document.querySelectorAll(".yd-shock__badge").length,
      periods: document.querySelectorAll(".yd-shock__period").length,
      sources: document.querySelectorAll(".yd-shock__source").length,
    }));
    if (cards.badges !== 3 || cards.periods !== 3 || cards.sources !== 3) {
      problems.push(
        `${theme} ${viewport.name}: stress cards carry ${cards.badges} badges / ${cards.periods} periods / ${cards.sources} sources, expected 3 each`,
      );
    }

    // A euro figure must never appear without the regime that produced it.
    const orphan = await page.evaluate(() =>
      [...document.querySelectorAll(".yd-tenv")].filter(
        (card) =>
          card.querySelector(".yd-tfig__value") !== null &&
          card.querySelector(".yd-tenv__regime") === null,
      ).length,
    );
    if (orphan > 0) {
      problems.push(`${theme} ${viewport.name}: ${orphan} tax card(s) show a figure with no regime`);
    }

    // The stress tables are wide by nature. They must scroll inside their OWN
    // box rather than push the page sideways — the rule since the credit
    // schedule.
    const scrollers = await page.evaluate(() =>
      [...document.querySelectorAll(".yd-shock__scroller")].map((box) => ({
        overflowing: box.scrollWidth > box.clientWidth,
        overflowX: getComputedStyle(box).overflowX,
      })),
    );
    for (const box of scrollers) {
      if (box.overflowing && box.overflowX !== "auto") {
        problems.push(
          `${theme} ${viewport.name}: a stress table overflows something other than its own scroller`,
        );
      }
    }
  }

  await page.waitForTimeout(700);
  await shot(page, viewport, theme);
  await audit("projection");

  // The assumptions form, open and filled — the hypotheses are editable, and a
  // panel nobody can open is a verdict rather than a tool. The refusal beside
  // the field that produced it is photographed too.
  await page.getByRole("button", { name: /Modifier les hypothèses/ }).click();
  await page.waitForSelector(".yd-assumptions__form", { timeout: 20000 });
  await page.getByLabel("Horizon (mois)").fill("9000");
  await page.getByRole("button", { name: /Relancer la projection/ }).click();
  await page.waitForSelector(".yd-assumptions__error", { timeout: 20000 });
  await expectOnScreen(
    page,
    `${theme} ${viewport.name} refus horizon`,
    "L'horizon doit être un nombre entier de mois compris entre 1 et 600.",
  );
  await page.waitForTimeout(400);
  await shot(page, viewport, theme, "-hypotheses");
  await audit("hypothèses");
}

const SCENARIOS = {
  "task-15": { drive: driveFeasibility, contrast: FEASIBILITY_CONTRAST, out: "phase-2b" },
  "task-16": { drive: driveFeasibility, contrast: FEASIBILITY_CONTRAST, out: "phase-2b" },
  "task-19": { drive: driveSimulators, contrast: SIMULATOR_CONTRAST, out: "phase-2b" },
  "task-20": { drive: driveProperty, contrast: SIMULATOR_CONTRAST, out: "phase-2b" },
  // The operator's state exactly as `seed_fixture.py` leaves it: no goal
  // declared, one challenge still proposed, one stored health snapshot.
  "task-2c": { drive: driveSuivi, contrast: SUIVI_CONTRAST, out: "phase-2c" },
  // The same screen after ONE goal has been declared through the real /goals
  // API and the challenge accepted through the real button — the two states
  // the fixture cannot reach on its own. Run AFTER task-2c: both mutate the
  // database, and neither is reversible.
  "task-2c-jalons": { drive: driveSuivi, contrast: SUIVI_CONTRAST, out: "phase-2c" },
  // The operator's own state exactly as seed_fixture.py leaves it: no
  // investment account, no position, no key, no target allocation.
  "task-10": { drive: drivePatrimoine, contrast: PATRIMOINE_CONTRAST, out: "phase-3" },
  // The same screen after three holdings have been declared through the real
  // /api/portfolio, one of them unpriceable. Run AFTER task-10: it mutates
  // the database, and it is not reversible.
  "task-10-positions": {
    drive: drivePatrimoine,
    contrast: PATRIMOINE_CONTRAST,
    out: "phase-3",
  },
  // The same screen's DECLARATION forms, driven end to end: the account, the
  // position and the first lot are created through the forms themselves on the
  // first combination. Run AFTER task-10, which photographs the empty state
  // this one leaves behind.
  "task-10-formulaires": {
    drive: drivePatrimoineForms,
    contrast: PATRIMOINE_CONTRAST,
    out: "phase-3",
  },
  // /projection on the operator's OWN state: zero positions, −746,19 €/month.
  // Four engines, four refusals, four different remedies.
  "task-16-projection": {
    drive: driveProjection,
    contrast: PROJECTION_CONTRAST,
    out: "phase-3",
  },
  // The same screen after three holdings have been declared through the real
  // /api/portfolio (see the seeding block below). Run AFTER
  // task-16-projection, which photographs the empty state this one leaves
  // behind: it mutates the database, and it is not reversible.
  "task-16-projection-garni": {
    drive: driveProjection,
    contrast: PROJECTION_CONTRAST,
    out: "phase-3",
  },
};

const scenario = SCENARIOS[TASK];
if (scenario === undefined) {
  console.error(`Unknown task "${TASK}". One of: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}

OUT = OUT_DIRS[scenario.out];
mkdirSync(OUT, { recursive: true });

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

/**
 * One declared goal, so the milestone panel has something real to draw.
 *
 * `seed_fixture.py` ships ZERO goals — the operator has genuinely declared
 * none, and `task-2c` photographs exactly that (the panel's own diagnosis).
 * This second pass creates one through the real POST /goals, which is what a
 * household does by hand: 900 € declared against a 3 000 € target puts the
 * 25 % threshold behind him and leaves three ahead, none of them projectable
 * on a capacity of −746,19 €/month. Nothing here is a MEASUREMENT that Yieldo
 * did not make — a goal is declared input, not measured output.
 */
if (TASK === "task-2c-jalons") {
  const { access_token: token } = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "demo@yieldo-demo.fr", password: "MotDePasseDemo123!" }),
  });
  const { goals } = await api("/goals", {}, token);
  if (goals.length === 0) {
    await api("/goals", {
      method: "POST",
      body: JSON.stringify({
        name: "Fonds d'urgence",
        target_cents: 300000,
        saved_cents: 90000,
        due_on: null,
        priority: 1,
      }),
    }, token);
    console.log("declared one goal for the milestone panel");
  }
}

/**
 * Three holdings and a target allocation, declared through the real
 * /api/portfolio — what a household does by hand.
 *
 * The three are chosen so that the screen's three price states are all on
 * screen AT ONCE, deterministically, **with no API key and no network**:
 *
 * 1. `EUR-CASH`, a `cash` instrument. `api/portfolio` values cash at par
 *    without ever touching a provider or the quota pool, so this is the one
 *    position that is always valued. It is what makes the total a real
 *    number rather than zero.
 * 2. `AAPL`, an equity. A deliberately old `price_points` row is seeded
 *    below, so the router answers from cache, finds it past its five-minute
 *    TTL, asks Finnhub, is refused for want of a key, and falls back to the
 *    cached value LABELLED STALE. A real value, counted in the total, shown
 *    with its age.
 * 3. `MC.PA`, an equity with no cached price at all. Finnhub refuses for the
 *    same reason and there is nothing to fall back to, so this one is
 *    genuinely MISSING: excluded from the total, carrying "aucune clé" as
 *    its cause.
 *
 * The targets then put equity 12 points under its 90 % goal against a
 * non-fractionable AAPL, which is the sub-unit refusal the allocation panel
 * has to print rather than propose a zero-unit order for.
 */
if (TASK === "task-10-positions") {
  const { access_token: token } = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "demo@yieldo-demo.fr", password: "MotDePasseDemo123!" }),
  });

  const accounts = await api("/portfolio/accounts", {}, token);
  if (accounts.length === 0) {
    const cto = await api("/portfolio/accounts", {
      method: "POST",
      body: JSON.stringify({ name: "CTO Boursorama", kind: "cto", currency: "EUR" }),
    }, token);

    const declare = async (instrument, quantity, unitCostCents) => {
      const registered = await api("/portfolio/instruments", {
        method: "POST",
        body: JSON.stringify(instrument),
      }, token);
      const position = await api("/portfolio/positions", {
        method: "POST",
        body: JSON.stringify({
          investment_account_id: cto.id,
          instrument_id: registered.id,
        }),
      }, token);
      await api("/portfolio/lots", {
        method: "POST",
        body: JSON.stringify({
          position_id: position.id,
          quantity,
          unit_cost_cents: unitCostCents,
          acquired_on: "2026-01-15",
        }),
      }, token);
      return registered;
    };

    // Valued at par, with no provider and no key. 2 500,00 EUR of cash.
    await declare(
      {
        symbol: "EUR-CASH",
        name: "Liquidités du compte",
        asset_class: "cash",
        currency: "EUR",
        is_fractionable: true,
      },
      "2500",
      100,
    );
    // Will read STALE off the cached point seeded just below.
    await declare(
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        asset_class: "equity",
        currency: "EUR",
        is_fractionable: false,
      },
      "12",
      15000,
    );
    // Will read MISSING: no cached price, and no key to fetch one.
    await declare(
      {
        symbol: "MC.PA",
        name: "LVMH",
        asset_class: "equity",
        currency: "EUR",
        is_fractionable: false,
      },
      "3",
      60000,
    );
    console.log("declared three holdings through the API");
  }

  // The one thing no API can do — see e2e/seed_stale_price.py for why. Run
  // every time rather than only on first seed: "old enough to be stale" is
  // relative to now, and a re-run days later must still be photographing a
  // stale price rather than a merely elderly fresh one.
  const python = path.resolve(HERE, "../backend/.venv/Scripts/python.exe");
  const seeder = path.resolve(HERE, "seed_stale_price.py");
  try {
    const out = execFileSync(python, [seeder, "AAPL", "equity", "18000", "3"], {
      encoding: "utf8",
    });
    console.log(out.trim());
  } catch (error) {
    // Loud, never silent: without the cached point AAPL reads as MISSING, and
    // the run would photograph two identical missing rows while claiming to
    // show a stale one beside a missing one.
    problems.push(`could not seed the stale price point: ${error.message}`);
  }

  // Written on EVERY run, not only the first: `PUT /targets` replaces the
  // whole set atomically, so re-running is idempotent, and the figures below
  // are chosen against the holdings above rather than against whatever an
  // earlier run happened to leave behind.
  //
  // 2 500,00 EUR of cash and 2 160,00 EUR of AAPL (12 x 180,00, the stale
  // cached price) make 4 660,00 EUR valued — MC.PA is excluded, having no
  // price at all. A 47 / 53 equity/cash target puts each side 30,20 EUR from
  // its goal, and that gap is what makes BOTH branches of the panel visible
  // at once: 30,2 units of cash, which is fractionable and gets an order,
  // against 0,168 of an AAPL share, which is NOT fractionable and gets the
  // refusal instead of a zero-unit order. A 90/10 target sized both cleanly
  // and photographed only half the panel.
  await api("/portfolio/targets", {
    method: "PUT",
    body: JSON.stringify({
      targets: [
        { asset_class: "equity", target_bps: 4_700 },
        { asset_class: "cash", target_bps: 5_300 },
      ],
    }),
  }, token);
  console.log("declared a 47/53 equity/cash target allocation");
}

/**
 * Three envelopes and four holdings, declared through the real /api/portfolio
 * — what a household does by hand — so /projection has something to project.
 *
 * The four are chosen so that every distinction this screen makes is on screen
 * AT ONCE, deterministically, **with no API key and no network**:
 *
 * 1. `MWRD` (equity) in a PEA opened in 2015 — past the five-year mark, so the
 *    tax panel prints `pea_exempt` with its article of the CGI.
 * 2. `OBLI-EU` (bond) in a CTO — `pfu`, with the barème priced beside it
 *    (`?tmi=3000`). It is also what makes 2008's POSITIVE bond figure visible:
 *    a shock is not always a loss.
 * 3. `AV-EUR` (cash) in an assurance-vie opened in 2015 — past eight years and
 *    under the 150 000 € premium threshold, so `assurance_vie_reduced` with a
 *    real 4 600 € abatement. Cash is valued at par with no provider at all.
 * 4. `WLD-ETF` (etf) in the CTO — the one class NO episode has data for, so
 *    "Aucune donnée" appears on all three stress cards rather than a silent 0 %.
 *
 * Every priced instrument is `equity`/`bond`/`etf`, which all route to Finnhub.
 * With no key registered Finnhub refuses immediately, WITHOUT a network call,
 * and the router falls back to the deliberately-old `price_points` row seeded
 * below — a real value, labelled stale, counted in the total. Crypto is avoided
 * on purpose: CoinGecko needs no key and would attempt a real request.
 */
if (TASK === "task-16-projection-garni") {
  const { access_token: token } = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "demo@yieldo-demo.fr", password: "MotDePasseDemo123!" }),
  });

  const accounts = await api("/portfolio/accounts", {}, token);
  const named = (name) => accounts.some((a) => a.name === name);

  const declare = async (accountId, instrument, quantity, unitCostCents) => {
    const registered = await api("/portfolio/instruments", {
      method: "POST",
      body: JSON.stringify(instrument),
    }, token);
    const position = await api("/portfolio/positions", {
      method: "POST",
      body: JSON.stringify({ investment_account_id: accountId, instrument_id: registered.id }),
    }, token);
    await api("/portfolio/lots", {
      method: "POST",
      body: JSON.stringify({
        position_id: position.id,
        quantity,
        unit_cost_cents: unitCostCents,
        acquired_on: "2020-01-15",
      }),
    }, token);
  };

  if (!named("PEA projection")) {
    const pea = await api("/portfolio/accounts", {
      method: "POST",
      body: JSON.stringify({
        name: "PEA projection", kind: "pea", currency: "EUR", opened_on: "2015-04-01",
      }),
    }, token);
    await declare(
      pea.id,
      { symbol: "MWRD", name: "Amundi MSCI World", asset_class: "equity", currency: "EUR", is_fractionable: false },
      "12",
      9000,
    );

    const cto = await api("/portfolio/accounts", {
      method: "POST",
      body: JSON.stringify({ name: "CTO projection", kind: "cto", currency: "EUR" }),
    }, token);
    await declare(
      cto.id,
      { symbol: "OBLI-EU", name: "Obligations souveraines EUR", asset_class: "bond", currency: "EUR", is_fractionable: false },
      "20",
      9500,
    );
    await declare(
      cto.id,
      { symbol: "WLD-ETF", name: "ETF diversifié", asset_class: "etf", currency: "EUR", is_fractionable: false },
      "10",
      8000,
    );

    const av = await api("/portfolio/accounts", {
      method: "POST",
      body: JSON.stringify({
        name: "Assurance-vie projection", kind: "assurance_vie", currency: "EUR",
        opened_on: "2015-01-01",
      }),
    }, token);
    await declare(
      av.id,
      { symbol: "AV-EUR", name: "Fonds euros", asset_class: "cash", currency: "EUR", is_fractionable: true },
      "20000",
      50,
    );
    console.log("declared three envelopes and four holdings through the API");
  }

  // Run EVERY time, not only on first seed: "old enough to be stale" is
  // relative to now, and a re-run days later must still be photographing a
  // stale price rather than a merely elderly fresh one. Loud on failure: with
  // no cached point these three read as MISSING, their envelopes refuse, and
  // the run would photograph four refusals while claiming to show a portfolio.
  const python = path.resolve(HERE, "../backend/.venv/Scripts/python.exe");
  const seeder = path.resolve(HERE, "seed_stale_price.py");
  for (const [symbol, assetClass, priceCents] of [
    ["MWRD", "equity", "18000"],
    ["OBLI-EU", "bond", "10000"],
    ["WLD-ETF", "etf", "10000"],
  ]) {
    try {
      console.log(
        execFileSync(python, [seeder, symbol, assetClass, priceCents, "3"], { encoding: "utf8" }).trim(),
      );
    } catch (error) {
      problems.push(`could not seed the stale price point for ${symbol}: ${error.message}`);
    }
  }
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
