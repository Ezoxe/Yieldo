import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { Account, Category, ImportSummary as ImportSummaryData } from "../../lib/types";
import { ColumnTagger } from "./ColumnTagger";
import { DialectPanel } from "./DialectPanel";
import { DropZone } from "./DropZone";
import { ImportHistory } from "./ImportHistory";
import "./ImportPage.css";
import { ImportSummary } from "./ImportSummary";
import { PreviewTable } from "./PreviewTable";
import { useImportWizard, type UseImportWizardResult, type WizardStep } from "./useImportWizard";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "file", label: "Fichier" },
  { key: "mapping", label: "Colonnes" },
  { key: "preview", label: "Aperçu" },
  { key: "done", label: "Terminé" },
];

/**
 * One source of truth for the shape of each wizard step, the same way
 * OverviewPage owns the dashboard's. At lg (12 columns) each step tiles
 * exactly:
 *
 *   file    | compte (5) | dépôt du fichier (7) / imports précédents (12)
 *   mapping | format (4) | taggage des colonnes (8)
 *   preview | résumé (12) / aperçu (12)
 *   done    | rapport (12)
 *
 * The column tagger is the screen's decision point -- nothing is imported
 * until the user has confirmed it -- so it is the widest cell of its step.
 * The preview table keeps the full width instead of sharing a row: it carries
 * seven columns, one of them a category picker, and anything narrower turns
 * the row the user is checking into a horizontal scroll.
 */
const SPAN = {
  account: { base: 1, md: 6, lg: 5 },
  drop: { base: 1, md: 6, lg: 7 },
  // Full width, under the two cells that start a new import: a list of one row
  // per past batch, four counts and an action is a band, not a column.
  history: { base: 1, md: 6, lg: 12 },
  newAccount: { base: 1, md: 6, lg: 12 },
  dialect: { base: 1, md: 6, lg: 4 },
  tagger: { base: 1, md: 6, lg: 8 },
  summary: { base: 1, md: 6, lg: 12 },
  preview: { base: 1, md: 6, lg: 12 },
  done: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

/** What clicking "Valider l'import" is about to write, in the user's terms. */
export interface CommitCounts {
  toImport: number;
  duplicatesIgnored: number;
  failed: number;
}

/**
 * The analysis counts the rows of the file; this counts the rows of the
 * *decision*, which is not the same thing once the user has ticked "Importer
 * quand même" on a duplicate.
 *
 * `keptDuplicates` is the length of the wizard's keep-list, so this figure
 * cannot disagree with the `canCommit` the button reads. Every fresh preview
 * filters that list down to rows it still reads as duplicates
 * (useImportWizard.ts), so a kept row is always one of `summary.duplicates` and
 * the subtraction below cannot go negative; the clamp is there so a future
 * caller of this exported function cannot put a nonsensical figure on screen.
 */
export function commitCounts(summary: ImportSummaryData, keptDuplicates: number): CommitCounts {
  return {
    toImport: summary.importable + keptDuplicates,
    duplicatesIgnored: Math.max(summary.duplicates - keptDuplicates, 0),
    failed: summary.failed,
  };
}

/**
 * Why the commit is refused, in French, or null when it is not. A greyed-out
 * button with no sentence under it is the dead end this screen is being fixed
 * for, so every state `canCommit` refuses has to answer here -- there is a
 * test over the whole matrix.
 */
export function commitBlockedReason(state: {
  isPreviewStale: boolean;
  errors: string[];
  total: number;
  toImport: number;
}): string | null {
  // First, because it is the contract: an aperçu computed under a different
  // tagging says nothing about what this mapping would import.
  if (state.isPreviewStale) {
    return "Le tagging a changé : relancez l'analyse pour actualiser l'aperçu avant de valider.";
  }
  // The message itself is already on screen in its own alert; repeating it
  // here would only say the same thing twice, in a smaller font.
  if (state.errors.length > 0) return "Corrigez l'erreur signalée ci-dessus avant de valider l'import.";
  if (state.toImport === 0) {
    return state.total === 0
      ? "Aucune ligne à importer : ce fichier ne contient aucune ligne exploitable."
      : "Aucune ligne à importer : toutes les lignes de ce fichier sont des doublons ou en erreur.";
  }
  return null;
}

// Mirrors the backend's ACCOUNT_KINDS (backend/app/models/account.py). "checking"
// is first and the form's default: the realistic case for a phase-1 user's very
// first bank account.
const ACCOUNT_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "checking", label: "Compte courant" },
  { value: "savings", label: "Livret d'épargne" },
  { value: "pea", label: "PEA" },
  { value: "life_insurance", label: "Assurance-vie" },
  { value: "per", label: "PER" },
  { value: "brokerage", label: "Compte-titres" },
  { value: "crypto", label: "Cryptomonnaies" },
  { value: "real_estate", label: "Immobilier" },
  { value: "loan", label: "Prêt" },
  { value: "cash", label: "Espèces" },
];

interface NewAccountInput {
  name: string;
  kind: string;
}

interface NewAccountFormProps {
  onCreate: (input: NewAccountInput) => Promise<void>;
  onCancel?: () => void;
}

// The bank account (Account) created here is distinct from the user account
// created at /inscription -- this form only ever exists on the import screen,
// scoped to that meaning of "compte". Wired to the existing POST /api/accounts
// (backend/app/api/accounts.py); nothing else in the app ever called it before.
function NewAccountForm({ onCreate, onCancel }: NewAccountFormProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>(ACCOUNT_KIND_OPTIONS[0].value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setError(null);
    setSubmitting(true);
    try {
      await onCreate({ name: trimmedName, kind });
      setName("");
      setKind(ACCOUNT_KIND_OPTIONS[0].value);
    } catch (err) {
      // The backend's own French detail (e.g. a 422 on an unknown kind) is
      // shown verbatim -- never a silent failure on the one form standing
      // between a new user and the rest of the app.
      setError(err instanceof ApiError ? err.detail : "Une erreur inattendue est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="yd-import__new-account" onSubmit={handleSubmit} noValidate>
      <div className="yd-import__new-account-fields">
        <label>
          <span>Nom du compte</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          <span>Type de compte</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            {ACCOUNT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="yd-import__alert">
          {error}
        </p>
      ) : null}

      <div className="yd-import__new-account-actions">
        <button type="submit" disabled={submitting || name.trim().length === 0}>
          {submitting ? "Création…" : "Créer"}
        </button>
        {onCancel ? (
          <button type="button" className="yd-dialect__cancel" onClick={onCancel} disabled={submitting}>
            Annuler
          </button>
        ) : null}
      </div>
    </form>
  );
}

function stepIndex(step: WizardStep): number {
  return STEPS.findIndex((item) => item.key === step);
}

interface StepProps {
  wizard: UseImportWizardResult;
}

// Shared by every step that can fail after the fact (commit, cancelImport): the
// backend's own French `detail` rendered verbatim in a role="alert", never
// silently dropped. FileStep and MappingStep already had their own copy of this
// block (MappingStep's lives inside ColumnTagger); this one covers PreviewStep
// and DoneStep, the two screens that write to (or undo) the user's ledger.
function ErrorAlert({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="yd-import__alert">
      <ul>
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

interface ActionBarAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface WizardActionBarProps {
  label: string;
  counts?: CommitCounts;
  /**
   * What the user needs to know about the primary action right now: why it is
   * refused when it is disabled, what is pending when it is not. Tied to the
   * button with aria-describedby, so it is not a colour-only signal.
   */
  note?: string | null;
  primary: ActionBarAction;
  secondary?: ActionBarAction;
}

/**
 * The step's way forward, pinned to the bottom of the viewport instead of
 * sitting under however many hundred rows the file happens to have. This is
 * the defect the whole task exists for: the operator scrolled a ~200-row
 * preview, never reached the commit button, and concluded his data had
 * vanished.
 *
 * `position: sticky` rather than `position: fixed` (see ImportPage.css): a
 * sticky bar occupies its own space at the end of the step, so it is pinned
 * while the page is longer than the viewport AND lands under the table's last
 * row once the user reaches the bottom -- it can never hide the final rows,
 * with no measured height and no reserved padding to keep in step with it.
 *
 * Not a dialog: no focus trap, no aria-modal. It is the last thing in the DOM
 * of its step, so the tab order runs table, then bar.
 */
function WizardActionBar({ label, counts, note, primary, secondary }: WizardActionBarProps) {
  const noteId = "yd-import-actionbar-note";
  const items = counts
    ? [
        {
          value: counts.toImport,
          label: plural(counts.toImport, "ligne à importer", "lignes à importer"),
          tone: "import",
        },
        {
          value: counts.duplicatesIgnored,
          label: plural(counts.duplicatesIgnored, "doublon ignoré", "doublons ignorés"),
          tone: "duplicate",
        },
        { value: counts.failed, label: plural(counts.failed, "ligne en erreur", "lignes en erreur"), tone: "failed" },
      ]
        // A row of zeroes is noise; what will be written is the decision, so it
        // is stated even when it is nothing (the note then says why).
        .filter((item) => item.tone === "import" || item.value > 0)
    : [];

  return (
    <div className="yd-import__actionbar" role="group" aria-label={label}>
      <div className="yd-import__actionbar-row">
        {items.length > 0 ? (
          <ul className="yd-import__counts">
            {items.map((item) => (
              <li className="yd-import__count" key={item.tone} data-tone={item.tone}>
                <span className="yd-num yd-import__count-value">{item.value}</span>{" "}
                <span className="yd-import__count-label">{item.label}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="yd-import__actionbar-buttons">
          {secondary ? (
            <button
              type="button"
              className="yd-import__back"
              onClick={secondary.onClick}
              disabled={secondary.disabled}
            >
              {secondary.label}
            </button>
          ) : null}
          <button
            type="button"
            className="yd-import__commit"
            onClick={primary.onClick}
            disabled={primary.disabled}
            aria-describedby={note ? noteId : undefined}
          >
            {primary.label}
          </button>
        </div>
      </div>

      {note ? (
        <p className="yd-import__actionbar-note" id={noteId} data-blocked={primary.disabled || undefined}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

interface FileStepProps extends StepProps {
  accounts: Account[];
  onCreateAccount: (input: NewAccountInput) => Promise<void>;
  reduced: boolean;
}

function FileStep({ wizard, accounts, onCreateAccount, reduced }: FileStepProps) {
  const { accountId, isBusy, errors, file, actions } = wizard;
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);

  // A freshly registered user has no bank account yet, and nothing else in
  // the app can create one -- a disabled select with nothing in it would be a
  // dead end. Show the creation form directly instead of a select with a
  // single unusable placeholder option.
  if (accounts.length === 0) {
    return (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.newAccount}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Votre premier compte</h2>
          <p className="yd-import__hint">
            Vous n'avez pas encore de compte bancaire dans Yieldo. Créez-en un pour commencer à
            importer vos relevés.
          </p>
          <NewAccountForm onCreate={onCreateAccount} />
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <BentoGrid as={motion.div} {...staggerProps(reduced)}>
      <BentoCell as={motion.div} span={SPAN.account} className="yd-panel" {...entryProps(reduced)}>
        <h2 className="yd-panel__title">Compte de destination</h2>

        <div className="yd-import__account-row">
          <label className="yd-import__account">
            <span>Compte</span>
            <select
              value={accountId ?? ""}
              onChange={(event) => actions.selectAccount(Number(event.target.value))}
            >
              <option value="" disabled>
                Choisir un compte…
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="yd-import__new-account-toggle"
            onClick={() => setShowNewAccountForm((open) => !open)}
          >
            {showNewAccountForm ? "Annuler" : "Nouveau compte"}
          </button>
        </div>

        {showNewAccountForm ? (
          <NewAccountForm
            onCreate={async (input) => {
              await onCreateAccount(input);
              setShowNewAccountForm(false);
            }}
            onCancel={() => setShowNewAccountForm(false)}
          />
        ) : null}
      </BentoCell>

      <BentoCell as={motion.div} span={SPAN.drop} className="yd-panel" {...entryProps(reduced)}>
        <h2 className="yd-panel__title">Relevé à importer</h2>

        <DropZone
          onFileSelected={actions.selectFile}
          disabled={isBusy || accountId === null}
          fileName={file?.name}
        />

        {isBusy ? <p className="yd-import__hint">Analyse du fichier…</p> : null}

        <ErrorAlert errors={errors} />
      </BentoCell>

      {/* Below the two cells that start a new import, because that is the
          order of intent: someone arriving here usually wants to import, and
          only sometimes wants to check or undo what they already did. It sits
          inside the step's stage, which is keyed on the step -- so coming back
          from a commit remounts it and the new batch is already listed. */}
      <BentoCell as={motion.div} span={SPAN.history} className="yd-panel" {...entryProps(reduced)}>
        <ImportHistory />
      </BentoCell>
    </BentoGrid>
  );
}

function MappingStep({ wizard, reduced }: StepProps & { reduced: boolean }) {
  const { preview, mapping, errors, dialect, profiles, isBusy, isPreviewStale, discardNotice, actions } =
    wizard;
  if (!preview) return null;

  return (
    <>
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.dialect} className="yd-panel" {...entryProps(reduced)}>
          <DialectPanel
            dialect={dialect}
            profiles={profiles}
            isBusy={isBusy}
            discardNotice={discardNotice}
            onDismissDiscardNotice={actions.dismissDiscardNotice}
            onFieldChange={(field, value) => {
              void actions.setDialectField(field, value);
            }}
            onSaveProfile={(name) => {
              void actions.saveProfile(name);
            }}
            onApplyProfile={actions.applyProfile}
          />
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.tagger}
          className="yd-panel yd-import__tagger-cell"
          {...entryProps(reduced)}
        >
          <ColumnTagger
            headers={preview.headers}
            sampleRows={preview.sample_rows}
            mapping={mapping}
            onRoleChange={actions.setRole}
            errors={errors}
          />
        </BentoCell>
      </BentoGrid>

      {/* The tagger is a wide table with a sample under every column: on a
          phone it is well past a screenful, so its own way forward is pinned
          exactly like the preview step's. */}
      <WizardActionBar
        label="Passer à l'aperçu"
        note={
          errors.length > 0
            ? "Corrigez le taggage des colonnes avant de continuer."
            : isPreviewStale
              ? "Le tagging a changé — l'aperçu doit être actualisé."
              : null
        }
        primary={{
          label: isBusy ? "Analyse…" : "Voir l'aperçu",
          onClick: () => {
            void actions.reanalyze();
          },
          disabled: isBusy || errors.length > 0,
        }}
      />
    </>
  );
}

function PreviewStep({
  wizard,
  categories,
  reduced,
}: StepProps & { categories: Category[]; reduced: boolean }) {
  const { preview, overrides, keepDuplicates, canCommit, isBusy, errors, isPreviewStale, actions } =
    wizard;
  if (!preview) return null;

  const counts = commitCounts(preview.summary, keepDuplicates.length);

  return (
    <>
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.summary} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Ce que contient le fichier</h2>
          <ImportSummary
            summary={preview.summary}
            batch={null}
            isBusy={isBusy}
            onCancelImport={() => {}}
          />
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.preview}
          className="yd-panel yd-import__preview-cell"
          {...entryProps(reduced)}
        >
          <PreviewTable
            rows={preview.rows}
            categories={categories}
            overrides={overrides}
            keepDuplicates={keepDuplicates}
            onOverrideCategory={actions.overrideCategory}
            onToggleKeepDuplicate={actions.toggleKeepDuplicate}
          />
        </BentoCell>
      </BentoGrid>

      {/* A failed commit (expired upload, invalid mapping caught server-side,
          unknown account...) must leave the user here, with their overrides and
          duplicate choices intact, and tell them why in the backend's own words. */}
      <ErrorAlert errors={errors} />

      <WizardActionBar
        label="Validation de l'import"
        counts={counts}
        note={commitBlockedReason({
          isPreviewStale,
          errors,
          total: preview.summary.total,
          toImport: counts.toImport,
        })}
        primary={{
          label: isBusy ? "Validation…" : "Valider l'import",
          onClick: () => {
            void actions.commit();
          },
          disabled: !canCommit || isBusy,
        }}
        secondary={{ label: "Retour au tagging", onClick: actions.backToMapping, disabled: isBusy }}
      />
    </>
  );
}

function DoneStep({ wizard, reduced }: StepProps & { reduced: boolean }) {
  const { batch, isBusy, errors, actions } = wizard;

  return (
    <BentoGrid as={motion.div} {...staggerProps(reduced)}>
      <BentoCell as={motion.div} span={SPAN.done} className="yd-panel" {...entryProps(reduced)}>
        <ImportSummary
          summary={null}
          batch={batch}
          isBusy={isBusy}
          onCancelImport={() => {
            void actions.cancelImport();
          }}
        />

        {/* A failed rollback (batch already gone, network error...) must not be
            swallowed -- the user just clicked "Annuler cet import" and needs to know
            it did not happen. */}
        <ErrorAlert errors={errors} />

        <button type="button" className="yd-import__restart" onClick={actions.reset}>
          Importer un autre fichier
        </button>
      </BentoCell>
    </BentoGrid>
  );
}

// The four-step wizard the whole product exists around: drop a file, tag its
// columns yourself, check what would happen, then say so explicitly. Every
// step below only ever *shows* what the backend proposed -- selectFile's
// suggested_mapping, detect_dialect's guessed dialect -- nothing here commits
// on the user's behalf.
export function ImportPage() {
  const wizard = useImportWizard();
  const { step, actions } = wizard;
  const reducedMotion = useReducedMotion();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [accountList, categoryList] = await Promise.all([
          api.get<Account[]>("/accounts"),
          api.get<Category[]>("/categories"),
        ]);
        if (cancelled) return;
        setAccounts(accountList);
        setCategories(categoryList);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.detail : "Une erreur inattendue est survenue.");
      }
    }
    void load();
    void actions.loadProfiles();
    return () => {
      cancelled = true;
    };
    // Runs once on mount only -- `actions` is a fresh object every render, but
    // its members are individually memoized, so re-running this on every
    // render would refetch accounts/categories for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The only place in the app that calls POST /api/accounts. Appends to the
  // in-memory list rather than refetching -- the wizard only needs the new
  // account to exist locally -- and selects it immediately so the user lands
  // straight on the drop zone instead of having to find it in the dropdown.
  async function handleCreateAccount(input: NewAccountInput): Promise<void> {
    const created = await api.post<Account>("/accounts", input);
    setAccounts((current) => [...current, created]);
    actions.selectAccount(created.id);
  }

  const activeIndex = stepIndex(step);

  return (
    <section className="yd-import">
      <h1>Import de relevé</h1>

      <ol className="yd-import__breadcrumb" aria-label="Étapes de l'import">
        {STEPS.map((item, index) => (
          <li
            key={item.key}
            className="yd-import__crumb"
            aria-current={index === activeIndex ? "step" : undefined}
            data-done={index < activeIndex || undefined}
          >
            <motion.span
              className="yd-import__crumb-marker"
              animate={index === activeIndex && !reducedMotion ? { scale: [1, 1.16, 1] } : undefined}
              transition={{ duration: 0.42 }}
            >
              {index + 1}
            </motion.span>
            <span className="yd-import__crumb-label">{item.label}</span>
          </li>
        ))}
      </ol>

      {loadError ? (
        <p role="alert" className="yd-import__alert">
          {loadError}
        </p>
      ) : null}

      {/* Keyed on the step, so every step change remounts the grid and replays
          its stagger -- the arrival IS the transition, which is why there is no
          second fade wrapped around it. */}
      <div className="yd-import__stage" key={step}>
        {step === "file" ? (
          <FileStep
            wizard={wizard}
            accounts={accounts}
            onCreateAccount={handleCreateAccount}
            reduced={reducedMotion}
          />
        ) : null}
        {step === "mapping" ? <MappingStep wizard={wizard} reduced={reducedMotion} /> : null}
        {step === "preview" ? (
          <PreviewStep wizard={wizard} categories={categories} reduced={reducedMotion} />
        ) : null}
        {step === "done" ? <DoneStep wizard={wizard} reduced={reducedMotion} /> : null}
      </div>
    </section>
  );
}
