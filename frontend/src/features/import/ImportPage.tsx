import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";

import { GlassCard } from "../../design/glass/GlassCard";
import { fadeInUp } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { ApiError, api } from "../../lib/api";
import type { Account, Category } from "../../lib/types";
import { ColumnTagger } from "./ColumnTagger";
import { DialectPanel } from "./DialectPanel";
import { DropZone } from "./DropZone";
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

interface FileStepProps extends StepProps {
  accounts: Account[];
  onCreateAccount: (input: NewAccountInput) => Promise<void>;
}

function FileStep({ wizard, accounts, onCreateAccount }: FileStepProps) {
  const { accountId, isBusy, errors, file, actions } = wizard;
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);

  // A freshly registered user has no bank account yet, and nothing else in
  // the app can create one -- a disabled select with nothing in it would be a
  // dead end. Show the creation form directly instead of a select with a
  // single unusable placeholder option.
  if (accounts.length === 0) {
    return (
      <GlassCard tone="solid" className="yd-import__panel">
        <div className="yd-import__empty-accounts">
          <p className="yd-import__hint">
            Vous n'avez pas encore de compte bancaire dans Yieldo. Créez-en un pour commencer à
            importer vos relevés.
          </p>
          <NewAccountForm onCreate={onCreateAccount} />
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard tone="solid" className="yd-import__panel">
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

      <DropZone
        onFileSelected={actions.selectFile}
        disabled={isBusy || accountId === null}
        fileName={file?.name}
      />

      {isBusy ? <p className="yd-import__hint">Analyse du fichier…</p> : null}

      <ErrorAlert errors={errors} />
    </GlassCard>
  );
}

function MappingStep({ wizard }: StepProps) {
  const { preview, mapping, errors, dialect, profiles, isBusy, isPreviewStale, actions } = wizard;
  if (!preview) return null;

  return (
    <div className="yd-import__panel">
      <DialectPanel
        dialect={dialect}
        profiles={profiles}
        isBusy={isBusy}
        onFieldChange={(field, value) => {
          void actions.setDialectField(field, value);
        }}
        onSaveProfile={(name) => {
          void actions.saveProfile(name);
        }}
        onApplyProfile={actions.applyProfile}
      />

      <ColumnTagger
        headers={preview.headers}
        sampleRows={preview.sample_rows}
        mapping={mapping}
        onRoleChange={actions.setRole}
        errors={errors}
      />

      <div className="yd-import__actions">
        <button
          type="button"
          className="yd-import__next"
          onClick={() => {
            void actions.reanalyze();
          }}
          disabled={isBusy || errors.length > 0}
        >
          {isBusy ? "Analyse…" : "Voir l'aperçu"}
        </button>
        {isPreviewStale && errors.length === 0 ? (
          <p className="yd-import__hint">Le tagging a changé — l'aperçu doit être actualisé.</p>
        ) : null}
      </div>
    </div>
  );
}

function PreviewStep({ wizard, categories }: StepProps & { categories: Category[] }) {
  const { preview, overrides, keepDuplicates, canCommit, isBusy, errors, actions } = wizard;
  if (!preview) return null;

  return (
    <div className="yd-import__panel">
      <ImportSummary summary={preview.summary} batch={null} isBusy={isBusy} onCancelImport={() => {}} />

      <PreviewTable
        rows={preview.rows}
        categories={categories}
        overrides={overrides}
        keepDuplicates={keepDuplicates}
        onOverrideCategory={actions.overrideCategory}
        onToggleKeepDuplicate={actions.toggleKeepDuplicate}
      />

      {/* A failed commit (expired upload, invalid mapping caught server-side,
          unknown account...) must leave the user here, with their overrides and
          duplicate choices intact, and tell them why in the backend's own words. */}
      <ErrorAlert errors={errors} />

      <div className="yd-import__actions">
        <button type="button" className="yd-import__back" onClick={actions.backToMapping} disabled={isBusy}>
          Retour au tagging
        </button>
        <button
          type="button"
          className="yd-import__commit"
          onClick={() => {
            void actions.commit();
          }}
          disabled={!canCommit || isBusy}
        >
          {isBusy ? "Validation…" : "Valider l'import"}
        </button>
      </div>
    </div>
  );
}

function DoneStep({ wizard }: StepProps) {
  const { batch, isBusy, errors, actions } = wizard;

  return (
    <div className="yd-import__panel">
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
    </div>
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

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={fadeInUp}
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          className="yd-import__stage"
        >
          {step === "file" ? (
            <FileStep wizard={wizard} accounts={accounts} onCreateAccount={handleCreateAccount} />
          ) : null}
          {step === "mapping" ? <MappingStep wizard={wizard} /> : null}
          {step === "preview" ? <PreviewStep wizard={wizard} categories={categories} /> : null}
          {step === "done" ? <DoneStep wizard={wizard} /> : null}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
