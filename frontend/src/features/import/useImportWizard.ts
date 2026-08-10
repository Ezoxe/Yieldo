import { useCallback, useRef, useState } from "react";

import { ApiError, api } from "../../lib/api";
import {
  ROLE_LABELS,
  type ColumnProfile,
  type ColumnRole,
  type CsvDialect,
  type ImportBatch,
  type ImportPreview,
} from "../../lib/types";

export type WizardStep = "file" | "mapping" | "preview" | "done";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

function toRoleMapping(raw: Record<string, string>): Record<number, ColumnRole> {
  const mapping: Record<number, ColumnRole> = {};
  for (const [key, value] of Object.entries(raw)) {
    mapping[Number(key)] = value as ColumnRole;
  }
  return mapping;
}

// Mirror of the backend's validate_mapping (backend/app/importers/mapping.py) so
// the user is told immediately, without a round trip. The server re-validates on
// analyze/commit regardless -- this only shortens the feedback loop; it must
// never drift from the server's own rules.
export function validateMapping(mapping: Record<number, ColumnRole>): string[] {
  const roles = Object.values(mapping);
  const errors: string[] = [];
  const counted = new Map<string, number>();
  for (const role of roles) {
    if (role === "ignore") continue;
    counted.set(role, (counted.get(role) ?? 0) + 1);
  }
  for (const [role, count] of counted) {
    if (count > 1) {
      errors.push(`Le rôle « ${ROLE_LABELS[role as ColumnRole]} » est attribué plusieurs fois.`);
    }
  }
  if (!roles.includes("date")) errors.push("Aucune colonne n'est taggée comme Date.");
  if (!roles.includes("label")) errors.push("Aucune colonne n'est taggée comme Libellé.");
  if (!roles.includes("amount") && !roles.includes("debit") && !roles.includes("credit")) {
    errors.push("Aucune colonne de Montant, ni de couple Débit / Crédit, n'est taggée.");
  }
  return errors;
}

interface WizardSnapshot {
  file: File | null;
  accountId: number | null;
  dialect: CsvDialect | null;
  mapping: Record<number, ColumnRole>;
  preview: ImportPreview | null;
  overrides: Record<number, number>;
  keepDuplicates: number[];
  batch: ImportBatch | null;
}

export interface UseImportWizardResult {
  step: WizardStep;
  file: File | null;
  accountId: number | null;
  dialect: CsvDialect | null;
  mapping: Record<number, ColumnRole>;
  preview: ImportPreview | null;
  overrides: Record<number, number>;
  keepDuplicates: number[];
  errors: string[];
  isBusy: boolean;
  isPreviewStale: boolean;
  canCommit: boolean;
  profiles: ColumnProfile[];
  batch: ImportBatch | null;
  actions: {
    selectFile: (file: File) => Promise<void>;
    selectAccount: (accountId: number) => void;
    setRole: (columnIndex: number, role: ColumnRole) => void;
    setDialectField: (field: keyof CsvDialect, value: string | number) => Promise<void>;
    applyProfile: (profile: ColumnProfile) => void;
    saveProfile: (name: string) => Promise<void>;
    loadProfiles: () => Promise<void>;
    reanalyze: () => Promise<void>;
    overrideCategory: (rowNumber: number, categoryId: number) => void;
    toggleKeepDuplicate: (rowNumber: number) => void;
    backToMapping: () => void;
    commit: () => Promise<void>;
    cancelImport: () => Promise<void>;
    reset: () => void;
  };
}

export function useImportWizard(): UseImportWizardResult {
  const [step, setStep] = useState<WizardStep>("file");
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [dialect, setDialect] = useState<CsvDialect | null>(null);
  const [mapping, setMapping] = useState<Record<number, ColumnRole>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [keepDuplicates, setKeepDuplicates] = useState<number[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isPreviewStale, setIsPreviewStale] = useState(false);
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [batch, setBatch] = useState<ImportBatch | null>(null);

  // Async actions read through this ref rather than the closed-over state above,
  // so a call started right after a synchronous setter (selectAccount, setRole...)
  // always observes that update. A plain closure would still hold whatever value
  // was current when the action function itself was created.
  const snapshot = useRef<WizardSnapshot>({
    file: null,
    accountId: null,
    dialect: null,
    mapping: {},
    preview: null,
    overrides: {},
    keepDuplicates: [],
    batch: null,
  });
  snapshot.current = { file, accountId, dialect, mapping, preview, overrides, keepDuplicates, batch };

  async function runAnalyze(
    targetFile: File,
    targetMapping?: Record<number, ColumnRole>,
    targetDialect?: CsvDialect,
  ): Promise<ImportPreview> {
    const form = new FormData();
    form.append("file", targetFile);
    form.append("account_id", String(snapshot.current.accountId));
    if (targetMapping) form.append("mapping", JSON.stringify(targetMapping));
    if (targetDialect) form.append("dialect", JSON.stringify(targetDialect));
    return api.upload<ImportPreview>("/imports/analyze", form);
  }

  const selectAccount = useCallback((nextAccountId: number) => {
    setAccountId(nextAccountId);
    // Dedup fingerprints are scoped to (account, date, amount, label): a preview
    // computed for a different account is no longer trustworthy.
    setIsPreviewStale((wasStale) => wasStale || snapshot.current.preview !== null);
  }, []);

  const selectFile = useCallback(async (nextFile: File) => {
    if (snapshot.current.accountId === null) {
      setErrors(["Sélectionnez un compte avant de déposer un fichier."]);
      return;
    }
    setFile(nextFile);
    setIsBusy(true);
    setErrors([]);
    try {
      const analyzed = await runAnalyze(nextFile);
      const nextMapping = toRoleMapping(analyzed.suggested_mapping);
      setPreview(analyzed);
      setDialect(analyzed.dialect);
      setMapping(nextMapping);
      setErrors(validateMapping(nextMapping));
      setOverrides({});
      setKeepDuplicates([]);
      setBatch(null);
      setIsPreviewStale(false);
      setStep("mapping");
    } catch (err) {
      setErrors([messageFor(err)]);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const setRole = useCallback((columnIndex: number, role: ColumnRole) => {
    setMapping((current) => {
      const next = { ...current, [columnIndex]: role };
      setErrors(validateMapping(next));
      return next;
    });
    // A preview computed under the previous mapping would misrepresent what this
    // mapping actually produces -- it must be recomputed before the user can commit.
    setIsPreviewStale(true);
  }, []);

  const reanalyze = useCallback(async () => {
    const current = snapshot.current;
    if (!current.file) return;
    setIsBusy(true);
    try {
      const analyzed = await runAnalyze(current.file, current.mapping, current.dialect ?? undefined);
      setPreview(analyzed);
      setIsPreviewStale(false);
      const freshErrors = validateMapping(current.mapping);
      setErrors(freshErrors);
      // A valid, freshly computed preview is what "preview" means: move the user
      // to the review screen. An invalid mapping keeps them on the tagger with
      // the errors that explain why.
      if (freshErrors.length === 0) setStep("preview");
    } catch (err) {
      setErrors([messageFor(err)]);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const setDialectField = useCallback(async (field: keyof CsvDialect, value: string | number) => {
    const current = snapshot.current;
    const baseDialect = current.dialect ?? current.preview?.dialect;
    if (!baseDialect || !current.file) return;
    const nextDialect = { ...baseDialect, [field]: value } as CsvDialect;
    setDialect(nextDialect);
    setIsPreviewStale(true);
    setIsBusy(true);
    try {
      const analyzed = await runAnalyze(current.file, current.mapping, nextDialect);
      setPreview(analyzed);
      setIsPreviewStale(false);
      setErrors(validateMapping(current.mapping));
    } catch (err) {
      setErrors([messageFor(err)]);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const applyProfile = useCallback((profile: ColumnProfile) => {
    const nextMapping = toRoleMapping(profile.mapping);
    setMapping(nextMapping);
    setDialect((current) => ({ ...(current ?? {}), ...profile.dialect }) as CsvDialect);
    setErrors(validateMapping(nextMapping));
    setIsPreviewStale(true);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const list = await api.get<ColumnProfile[]>("/imports/profiles");
      setProfiles(list);
    } catch (err) {
      setErrors((current) => [...current, messageFor(err)]);
    }
  }, []);

  const saveProfile = useCallback(async (name: string) => {
    const current = snapshot.current;
    if (!current.dialect) return;
    try {
      const created = await api.post<ColumnProfile>("/imports/profiles", {
        name,
        dialect: current.dialect,
        mapping: current.mapping,
      });
      setProfiles((list) => [...list, created]);
    } catch (err) {
      setErrors((list) => [...list, messageFor(err)]);
    }
  }, []);

  const overrideCategory = useCallback((rowNumber: number, categoryId: number) => {
    setOverrides((current) => ({ ...current, [rowNumber]: categoryId }));
  }, []);

  const toggleKeepDuplicate = useCallback((rowNumber: number) => {
    setKeepDuplicates((current) =>
      current.includes(rowNumber)
        ? current.filter((row) => row !== rowNumber)
        : [...current, rowNumber],
    );
  }, []);

  // Reviewing the preview is not a one-way door: the user must be able to go back
  // and retag a column they got wrong without restarting the whole wizard.
  const backToMapping = useCallback(() => setStep("mapping"), []);

  const commit = useCallback(async () => {
    const current = snapshot.current;
    if (!current.preview || !current.dialect || current.accountId === null) return;
    setIsBusy(true);
    try {
      const created = await api.post<ImportBatch>("/imports/commit", {
        upload_token: current.preview.upload_token,
        account_id: current.accountId,
        original_filename: current.preview.original_filename,
        dialect: current.dialect,
        mapping: current.mapping,
        overrides: current.overrides,
        keep_duplicates: current.keepDuplicates,
      });
      setBatch(created);
      setStep("done");
    } catch (err) {
      setErrors([messageFor(err)]);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    setStep("file");
    setFile(null);
    setDialect(null);
    setMapping({});
    setPreview(null);
    setOverrides({});
    setKeepDuplicates([]);
    setBatch(null);
    setErrors([]);
    setIsPreviewStale(false);
    setIsBusy(false);
  }, []);

  const cancelImport = useCallback(async () => {
    const current = snapshot.current;
    if (!current.batch) return;
    setIsBusy(true);
    try {
      await api.delete(`/imports/${current.batch.id}`);
      reset();
    } catch (err) {
      setErrors([messageFor(err)]);
    } finally {
      setIsBusy(false);
    }
  }, [reset]);

  const canCommit =
    errors.length === 0 &&
    preview !== null &&
    !isPreviewStale &&
    preview.summary.importable + keepDuplicates.length > 0;

  return {
    step,
    file,
    accountId,
    dialect,
    mapping,
    preview,
    overrides,
    keepDuplicates,
    errors,
    isBusy,
    isPreviewStale,
    canCommit,
    profiles,
    batch,
    actions: {
      selectFile,
      selectAccount,
      setRole,
      setDialectField,
      applyProfile,
      saveProfile,
      loadProfiles,
      reanalyze,
      overrideCategory,
      toggleKeepDuplicate,
      backToMapping,
      commit,
      cancelImport,
      reset,
    },
  };
}
