import { expect, test } from "@playwright/test";
import path from "node:path";

// Two years of a simple French bank statement -- semicolon-delimited, comma
// decimals, dd/mm/yyyy dates -- the shape most French banks export. Two
// CARREFOUR MARKET lines exist on purpose: the second is what the
// "recategorize" step below backfills. With only one occurrence, the rule
// learned from correcting the first would have nothing else to touch and the
// "Règle apprise" banner would never appear. 8 data rows total, 6 of them in
// 2025 (the other 2 fall in 2026, to exercise the period filter).
const CSV = path.join(__dirname, "..", "fixtures", "releve.csv");
const CSV_ROW_COUNT = 8;

// Playwright Test gives every test() its own browser context by default, so
// the httpOnly refresh cookie the session lives on (see
// frontend/src/features/auth/session.ts) does not survive from one test to
// the next on its own -- despite this file reading like one continuous
// story. The first test saves its context's storageState; the second loads
// it into a fresh context, the way a returning visitor's browser would carry
// a cookie across tabs. The access token itself is kept in memory only
// (frontend/src/lib/api.ts) and is deliberately never in storageState:
// RequireAuth's hydrate() (frontend/src/features/auth/RequireAuth.tsx)
// trades the restored refresh cookie for a fresh access token on load, which
// is why simply navigating with the saved cookie is enough to arrive signed
// in. serial mode plus this config's single worker keep the two tests
// strictly ordered, which the handoff below depends on.
test.describe.configure({ mode: "serial" });

let storageStatePath: string;

test("first run: register, import a CSV, read the dashboard, recategorize a transaction", async ({
  page,
}, testInfo) => {
  const email = `max-${Date.now()}@example.com`;

  // --- Registration --------------------------------------------------
  await page.goto("/inscription");
  await page.getByLabel("Nom").fill("Max");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill("motdepasse123");
  await page.getByLabel("Confirmer le mot de passe").fill("motdepasse123");

  // ImportPage's account dropdown (see frontend/src/features/import/ImportPage.tsx,
  // FileStep) is the only place an account can be picked FROM -- phase 1 has
  // no "create account" screen anywhere in the frontend (checked
  // ImportPage.tsx, DropZone.tsx and SettingsPage.tsx). The backend does
  // expose POST /accounts (backend/app/api/accounts.py); this is that
  // endpoint called directly with the token the register response just
  // handed back, exactly as an operator would have to before such a screen
  // exists.
  const [registerResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/api/auth/register") && response.status() === 201,
    ),
    page.getByRole("button", { name: "Créer mon compte" }).click(),
  ]);
  await expect(page).toHaveURL(/\/$/);

  const { access_token: accessToken } = (await registerResponse.json()) as { access_token: string };
  const accountResponse = await page.request.post("/api/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: "Compte courant", kind: "checking" },
  });
  expect(accountResponse.ok()).toBe(true);

  // --- Import: drop the file, check the proposed tagging, commit -----
  await page.getByRole("link", { name: "Import" }).click();
  await page.getByLabel("Compte").selectOption({ label: "Compte courant" });
  await page.setInputFiles('input[type="file"]', CSV);

  // The column tagger must appear with preselected -- but editable -- roles.
  // Values come from the backend's header-name heuristics (see
  // backend/app/importers/mapping.py): "Date" -> date, "Libelle" -> label
  // (matches the libell.. pattern), "Debit"/"Credit" -> debit/credit.
  await expect(page.getByText("Taggez vos colonnes")).toBeVisible();
  await expect(page.getByLabel('Rôle de la colonne "Date"')).toHaveValue("date");
  await expect(page.getByLabel('Rôle de la colonne "Libelle"')).toHaveValue("label");
  await expect(page.getByLabel('Rôle de la colonne "Debit"')).toHaveValue("debit");
  await expect(page.getByLabel('Rôle de la colonne "Credit"')).toHaveValue("credit");

  // "Voir l'aperçu" is also the wizard's re-analyze trigger (see
  // useImportWizard.ts, reanalyze()) -- nothing was retagged here, but the
  // click still recomputes the preview the commit below is built from.
  await page.getByRole("button", { name: "Voir l'aperçu" }).click();
  await expect(page.getByText("Aperçu des lignes")).toBeVisible();

  const importableStat = page.locator(".yd-summary__item", { hasText: "Importables" });
  await expect(importableStat).toContainText(String(CSV_ROW_COUNT));

  await page.getByRole("button", { name: "Valider l'import" }).click();
  await expect(page.getByText("Import terminé")).toBeVisible();
  // ImportSummary's plural() appends the "s" to the end of the whole phrase,
  // not after "ligne" -- "8 ligne importées" is the actual rendered text,
  // not a typo in this test (see frontend/src/features/import/ImportSummary.tsx).
  await expect(page.getByText(`${CSV_ROW_COUNT} ligne importées`)).toBeVisible();

  // --- Dashboard: filter to the 2025-only period -----------------------
  await page.getByRole("link", { name: "Vue d'ensemble" }).click();
  await page.getByRole("tab", { name: "Tout" }).click();
  await expect(page.getByText("Entrées")).toBeVisible();

  // 2025 only: two 2 450,00 € salary lines = 4 900,00 €, not the 2026 one.
  // CountUp renders the formatted amount as an aria-label on a role="status"
  // element (frontend/src/design/CountUp.tsx) -- that is the accessible,
  // stable way to read it, rather than the animated digits themselves.
  await page.getByRole("tab", { name: "Personnalisé" }).click();
  await page.getByLabel("Du").fill("2025-01-01");
  await page.getByLabel("Au").fill("2025-12-31");
  await expect(page.getByRole("status", { name: "4 900,00 €" })).toBeVisible();

  // --- Transactions: recategorize and watch the learned rule backfill ---
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText("LOYER APPARTEMENT").first()).toBeVisible();

  // Two rows contain "CARREFOUR MARKET" as a substring ("CARREFOUR MARKET"
  // and "CARREFOUR MARKET CB"); filter on the exact label-cell text so this
  // resolves to exactly one row instead of tripping Playwright's strict mode.
  const carrefourRow = page
    .getByRole("row")
    .filter({ has: page.getByText("CARREFOUR MARKET", { exact: true }) });
  // Both CARREFOUR lines were already auto-categorized as "Courses" by the
  // builtin "carrefour" rule (backend/app/categorization/seed.py) -- picking
  // that same category again would fire no change event at all. "Restaurants"
  // is a real, different category, so this is a genuine correction.
  await carrefourRow.getByLabel("Catégorie").selectOption({ label: "Restaurants" });
  await expect(page.getByText(/Règle apprise/)).toBeVisible();

  storageStatePath = testInfo.outputPath("session.json");
  await page.context().storageState({ path: storageStatePath });
});

test("re-importing the same file adds nothing", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();

  await page.goto("/import");
  await page.getByLabel("Compte").selectOption({ label: "Compte courant" });
  await page.setInputFiles('input[type="file"]', CSV);

  await expect(page.getByText("Taggez vos colonnes")).toBeVisible();
  await page.getByRole("button", { name: "Voir l'aperçu" }).click();
  await expect(page.getByText("Aperçu des lignes")).toBeVisible();

  const duplicatesStat = page.locator(".yd-summary__item", { hasText: "Doublons" });
  await expect(duplicatesStat).toContainText(String(CSV_ROW_COUNT));
  // All 8 rows already exist -- 0 importable, 0 kept duplicates -- so
  // canCommit is false (see useImportWizard.ts) and the button stays disabled.
  await expect(page.getByRole("button", { name: "Valider l'import" })).toBeDisabled();

  await context.close();
});
