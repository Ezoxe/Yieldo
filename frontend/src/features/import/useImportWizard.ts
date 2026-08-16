import { useCallback, useRef, useState } from "react";

import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
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

/**
 * Which dialect fields renumber the rows.
 *
 * `overrides` and `keepDuplicates` are keyed by `row_number`, which the backend
 * assigns as a 1-based index into the file's *data* rows (see
 * backend/app/importers/parser.py). Moving the header or the preamble shifts
 * where the data starts, so every row number now names a different transaction
 * -- a category correction that survived would silently land on one the user
 * never looked at. The other dialect fields (delimiter, encoding, decimal
 * separator, date format, quote char) change how a row is read, never which
 * rows there are, so the choices made against them still hold.
 */
const REINDEXING_DIALECT_FIELDS: ReadonlySet<keyof CsvDialect> = new Set([
  "header_row",
  "preamble_rows",
]);

/** How each re-indexing field is named to the user, for the notice below. */
const REINDEXING_FIELD_LABELS: Partial<Record<keyof CsvDialect, string>> = {
  header_row: "La ligne d'en-tête a changé",
  preamble_rows: "Le nombre de lignes de préambule a changé",
};

/**
 * What the discard just cost the user, in French -- or null when it cost
 * nothing.
 *
 * Dropping the row-keyed choices is right (see REINDEXING_DIALECT_FIELDS);
 * dropping them without a word is the silent failure this repository's contract
 * forbids. The user has no reason to expect that nudging the preamble spinner
 * undoes the categories they fixed on the preview, and nothing else on the
 * screen would tell them: the errors list is normally empty, and the choices
 * simply are not there when they look back at the table.
 *
 * Null on a zero total, because that spinner is a bare number input firing
 * onChange on every keystroke: typing "12" gets here twice, and the second pass
 * -- which has nothing left to discard -- must not announce anything.
 *
 * Every clause is active voice ("a annulé X"), so the sentence needs no
 * agreement with what follows and one wording covers both counts and both
 * genders.
 */
function discardMessage(
  field: keyof CsvDialect,
  overrides: number,
  keepDuplicates: number,
): string | null {
  const total = overrides + keepDuplicates;
  if (total === 0) return null;
  const lost: string[] = [];
  if (overrides > 0) {
    lost.push(`${overrides} ${plural(overrides, "catégorie corrigée", "catégories corrigées")}`);
  }
  if (keepDuplicates > 0) {
    lost.push(`${keepDuplicates} ${plural(keepDuplicates, "doublon conservé", "doublons conservés")}`);
  }
  const cause = REINDEXING_FIELD_LABELS[field] ?? "Le format du fichier a changé";
  return (
    `${cause} : les lignes du fichier sont renumérotées, ce qui a annulé ${lost.join(" et ")}. ` +
    `${plural(total, "Reprenez ce choix", "Reprenez ces choix")} sur l'aperçu.`
  );
}

/**
 * The keep-list, cut down to what the fresh preview still reads as a duplicate.
 *
 * A row the user forced through, that a re-analysis then read as importable on
 * its own, is inside `summary.importable` now. Left in the keep-list it would be
 * counted a second time: the action bar would promise N+1 rows for a commit
 * writing N, and `canCommit` -- which reads the same sum -- could enable a
 * commit of nothing at all.
 */
function keepsStillDuplicated(kept: number[], analyzed: ImportPreview): number[] {
  return kept.filter((rowNumber) =>
    analyzed.rows.some((row) => row.row_number === rowNumber && row.is_duplicate),
  );
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
  errors: string[];
  isPreviewStale: boolean;
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
  /**
   * What the last re-indexing dialect change discarded, in French, or null.
   * Not an error -- the discard is correct behaviour -- so it is not folded
   * into `errors`; it is a notice the screen shows next to the control that
   * caused it, until the user dismisses it or relaunches the analysis.
   */
  discardNotice: string | null;
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
    dismissDiscardNotice: () => void;
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
  const [discardNotice, setDiscardNotice] = useState<string | null>(null);
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
    errors: [],
    isPreviewStale: false,
  });
  snapshot.current = {
    file,
    accountId,
    dialect,
    mapping,
    preview,
    overrides,
    keepDuplicates,
    batch,
    errors,
    isPreviewStale,
  };

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
    setDiscardNotice(null);
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
      setKeepDuplicates((kept) => keepsStillDuplicated(kept, analyzed));
      setIsPreviewStale(false);
      // The user has read the notice and moved on: this fresh preview is the
      // one their next choices are made against, so the sentence about the
      // previous numbering has had its say.
      setDiscardNotice(null);
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
    const reindexes = REINDEXING_DIALECT_FIELDS.has(field);
    setDialect(nextDialect);
    setIsPreviewStale(true);
    setIsBusy(true);

    // Before the request, not after it. `dialect` above is already the
    // re-indexing one, so choices left behind by a failed analyze (network
    // drop, 401, 413, backend 500) would be sent under the new numbering by the
    // next "Voir l'aperçu" -- reanalyze never clears them.
    if (reindexes) {
      // Every row number the user's choices were made against now points
      // somewhere else; there is no honest way to carry them over. Say so:
      // `message` is null when there was nothing to discard, and a no-op pass
      // must neither announce anything nor wipe a notice already on screen.
      const message = discardMessage(
        field,
        Object.keys(current.overrides).length,
        current.keepDuplicates.length,
      );
      setOverrides({});
      setKeepDuplicates([]);
      if (message) setDiscardNotice(message);
    }

    try {
      const analyzed = await runAnalyze(current.file, current.mapping, nextDialect);
      setPreview(analyzed);
      if (!reindexes) setKeepDuplicates((kept) => keepsStillDuplicated(kept, analyzed));
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

  const dismissDiscardNotice = useCallback(() => setDiscardNotice(null), []);

  // Reviewing the preview is not a one-way door: the user must be able to go back
  // and retag a column they got wrong without restarting the whole wizard.
  const backToMapping = useCallback(() => setStep("mapping"), []);

  const commit = useCallback(async () => {
    const current = snapshot.current;
    if (!current.preview || !current.dialect || current.accountId === null) return;
    // The invariant this app is built around: never send a mapping to the backend
    // that differs from the one the preview on screen was computed under. The
    // "Valider l'import" button's `disabled` attribute is a convenience, not the
    // enforcement -- this check is, since commit() can be (and, in a test, is)
    // called directly. Fails loudly: an error the user can see, not a silent no-op.
    if (current.isPreviewStale || current.errors.length > 0) {
      setErrors([
        "L'aperçu ne correspond plus au tagging actuel : relancez l'analyse avant de valider l'import.",
      ]);
      return;
    }
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
    setDiscardNotice(null);
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
    discardNotice,
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
      dismissDiscardNotice,
      backToMapping,
      commit,
      cancelImport,
      reset,
    },
  };
}
