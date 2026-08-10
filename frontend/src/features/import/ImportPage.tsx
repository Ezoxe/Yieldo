import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

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

function stepIndex(step: WizardStep): number {
  return STEPS.findIndex((item) => item.key === step);
}

interface StepProps {
  wizard: UseImportWizardResult;
}

function FileStep({ wizard, accounts }: StepProps & { accounts: Account[] }) {
  const { accountId, isBusy, errors, file, actions } = wizard;

  return (
    <GlassCard tone="solid" className="yd-import__panel">
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

      <DropZone
        onFileSelected={actions.selectFile}
        disabled={isBusy || accountId === null}
        fileName={file?.name}
      />

      {isBusy ? <p className="yd-import__hint">Analyse du fichier…</p> : null}

      {errors.length > 0 ? (
        <div role="alert" className="yd-import__alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
  const { preview, overrides, keepDuplicates, canCommit, isBusy, actions } = wizard;
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
  const { batch, isBusy, actions } = wizard;

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
          {step === "file" ? <FileStep wizard={wizard} accounts={accounts} /> : null}
          {step === "mapping" ? <MappingStep wizard={wizard} /> : null}
          {step === "preview" ? <PreviewStep wizard={wizard} categories={categories} /> : null}
          {step === "done" ? <DoneStep wizard={wizard} /> : null}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
