import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import "../../design/Skeleton.css";
import { api } from "../../lib/api";
import { messageFor, refusalReason } from "../../lib/refusal";
import type {
  ExportDocument,
  ExportFile,
  ExportFormat,
  ExportGranularity,
  ExportOptions,
  ExportScopeRequest,
  ExportTemplate,
} from "../../lib/types";
import "./ExportPage.css";

const SPAN = {
  scope: { base: 1, md: 6, lg: 5 },
  templates: { base: 1, md: 6, lg: 7 },
  full: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

/** The modules a first arrival ticks: the ledger-backed ones, which are the
 *  only ones a household that has imported statements and nothing else can
 *  actually fill. Positions, projections and fiscalité stay unticked rather
 *  than shipping a document made mostly of "aucune donnée". */
const DEFAULT_MODULES = ["profil", "budget", "analyses", "recurrences"];

const GRANULARITIES: { value: ExportGranularity; label: string }[] = [
  { value: "annual", label: "Agrégats annuels" },
  { value: "monthly", label: "Agrégats mensuels" },
  { value: "transaction", label: "Transaction par transaction" },
];

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "md", label: ".md" },
  { value: "txt", label: ".txt" },
  { value: "json", label: ".json" },
];

/** How long the screen waits after a change before re-measuring. Long enough
 *  that dragging through a date field is one request rather than eight, short
 *  enough that the estimate still reads as live. */
const DEBOUNCE_MS = 300;

const FR_INT = new Intl.NumberFormat("fr-FR");

interface CheckListProps {
  legend: string;
  hint: string;
  testid: string;
  items: { key: string; id: string; label: string }[];
  checked: (key: string) => boolean;
  onToggle: (key: string) => void;
}

/**
 * One group of checkboxes.
 *
 * The list scrolls inside its OWN box: the operator has 69 categories, and a
 * panel that grew to their full height would push every other cell of the
 * grid off the first screen at 375 px.
 */
function CheckList({ legend, hint, testid, items, checked, onToggle }: CheckListProps) {
  return (
    <fieldset className="yd-scope__group">
      <legend className="yd-scope__legend">{legend}</legend>
      <p className="yd-scope__hint">{hint}</p>
      <div className="yd-scope__list" data-testid={testid}>
        {items.map((item) => (
          <label key={item.key} className="yd-scope__check" data-testid={`${testid}-${item.key}`}>
            <input
              type="checkbox"
              id={item.id}
              checked={checked(item.key)}
              onChange={() => onToggle(item.key)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * `/export` — the context export. Design §8.2.
 *
 * **The scope is the feature.** Everything the panel does not tick is excluded
 * from the document, and the document says so at the top of itself. The token
 * estimate is re-measured by the API on every change, because an estimate that
 * lagged behind the scope would be an estimate of a document nobody asked for.
 *
 * **A refusal is content.** An engine declining to build (anonymisation with
 * no spending to be relative to) prints its own French sentence on the warning
 * rule; a `role="alert"` on this screen means the round trip itself failed.
 * A document too big for the chosen window is neither: it is a measurement,
 * and it is shown as one.
 */
export function ExportPage() {
  const reduced = useReducedMotion();
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [applied, setApplied] = useState<ExportTemplate | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [accountIds, setAccountIds] = useState<number[] | null>(null);
  const [categoryIds, setCategoryIds] = useState<number[] | null>(null);
  const [granularity, setGranularity] = useState<ExportGranularity>("monthly");
  const [modules, setModules] = useState<string[]>(DEFAULT_MODULES);
  const [anonymise, setAnonymise] = useState(false);
  const [targetModel, setTargetModel] = useState<string>("");

  const [document_, setDocument] = useState<ExportDocument | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const [loadedOptions, loadedTemplates] = await Promise.all([
          api.get<ExportOptions>("/export/options"),
          api.get<ExportTemplate[]>("/export/templates"),
        ]);
        if (cancelled) return;
        setOptions(loadedOptions);
        setTemplates(loadedTemplates);
        // The ledger's own span, never an invented one. A household that has
        // imported nothing gets empty fields, which the API reads as "as far
        // as there is data" — and that is honest for an empty ledger too.
        setDateFrom(loadedOptions.ledger_date_from ?? "");
        setDateTo(loadedOptions.ledger_date_to ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(messageFor(err));
          setIsMeasuring(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const scope: ExportScopeRequest = useMemo(
    () => ({
      date_from: dateFrom === "" ? null : dateFrom,
      date_to: dateTo === "" ? null : dateTo,
      account_ids: accountIds,
      category_ids: categoryIds,
      granularity,
      modules,
      anonymise,
      target_model: targetModel === "" ? null : targetModel,
    }),
    [dateFrom, dateTo, accountIds, categoryIds, granularity, modules, anonymise, targetModel],
  );

  // Re-measured on every scope change, debounced. `options === null` gates it
  // so the first request carries the ledger's span rather than an empty one.
  useEffect(() => {
    if (options === null) return;
    if (modules.length === 0) {
      // The API requires at least one module. Refused here, in French, rather
      // than sending a request that can only come back 422.
      setDocument(null);
      setRefusal("Sélectionnez au moins un module : un document sans module est vide.");
      setIsMeasuring(false);
      return;
    }
    let cancelled = false;
    setIsMeasuring(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const built = await api.post<ExportDocument>("/export", scope);
          if (cancelled) return;
          setDocument(built);
          setRefusal(null);
          setError(null);
        } catch (err) {
          if (cancelled) return;
          setDocument(null);
          const reason = refusalReason(err);
          setRefusal(reason);
          setError(reason === null ? messageFor(err) : null);
        } finally {
          if (!cancelled) setIsMeasuring(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope, options, modules.length]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  function applyTemplate(template: ExportTemplate) {
    setApplied(template);
    setDateFrom(template.date_from);
    setDateTo(template.date_to);
    setGranularity(template.granularity);
    setModules(template.modules);
    setAnonymise(template.anonymise);
    // A template speaks about the whole household: it never narrows the
    // accounts or the categories, and picking one clears any narrowing the
    // reader had applied rather than silently keeping it.
    setAccountIds(null);
    setCategoryIds(null);
  }

  const flash = useCallback((message: string) => {
    setCopied(message);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2_500);
  }, []);

  async function copy(text: string, message: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      flash(message);
    } catch {
      // Never a silent failure: a button that reported success while copying
      // nothing is worse than one that says the browser refused.
      setError(
        "Le presse-papiers a refusé la copie. Sélectionnez le document ci-dessous et copiez-le à la main, ou téléchargez-le.",
      );
    }
  }

  async function download(format: ExportFormat) {
    setError(null);
    try {
      const file = await api.post<ExportFile>("/export/download", { ...scope, format });
      const blob = new Blob([file.content], { type: file.content_type });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      flash(`${file.filename} téléchargé`);
    } catch (err) {
      setError(messageFor(err));
    }
  }

  const toggle = (list: number[] | null, id: number, every: number[]): number[] | null => {
    // `null` means "every one of them" — the first click on a checked box has
    // to materialise that set before removing from it, or unticking one
    // account would read as unticking all of them.
    const current = list ?? every;
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id];
    return next.length === every.length ? null : next;
  };

  return (
    <section className="yd-export">
      <div className="yd-export__header">
        <h1>Export de contexte</h1>
        <p className="yd-export__lead">
          Composez un document Markdown à partir de vos propres données et donnez-le à l'IA de
          votre choix. Vous choisissez la période, les comptes, les catégories, la finesse et les
          modules&nbsp;: <strong>tout ce qui n'est pas coché est absent du document</strong>, et le
          document le dit en tête. Le volume est mesuré en continu, et Yieldo prévient quand il
          dépasse la fenêtre du modèle visé.
        </p>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-export__alert" data-testid="yd-export-error">
          {error}
        </p>
      ) : null}

      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.scope} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Périmètre</h2>
          {options === null ? (
            <div role="status" aria-busy="true" aria-label="Chargement du périmètre">
              <div className="yd-skeleton yd-skeleton--patrimoine-card" aria-hidden="true" />
            </div>
          ) : (
            <div className="yd-scope" data-testid="yd-export-scope">
              <div className="yd-scope__dates">
                <label className="yd-scope__field">
                  <span>Du</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                </label>
                <label className="yd-scope__field">
                  <span>Au</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                  />
                </label>
              </div>
              <p className="yd-scope__hint">
                Bornes incluses. Vides, elles couvrent tout ce que vos relevés contiennent
                {options.ledger_date_from !== null
                  ? ` (du ${options.ledger_date_from} au ${options.ledger_date_to})`
                  : " — et vous n'avez encore rien importé"}
                .
              </p>

              <label className="yd-scope__field yd-scope__field--wide">
                <span>Granularité</span>
                <select
                  value={granularity}
                  onChange={(event) =>
                    setGranularity(event.target.value as ExportGranularity)
                  }
                >
                  {GRANULARITIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <CheckList
                legend="Comptes"
                hint="Aucun coché signifie « tous »."
                testid="yd-export-account"
                items={options.accounts.map((account) => ({
                  key: String(account.id),
                  id: `yd-export-account-${account.id}`,
                  label: account.name,
                }))}
                checked={(key) =>
                  accountIds === null || accountIds.includes(Number(key))
                }
                onToggle={(key) =>
                  setAccountIds((current) =>
                    toggle(current, Number(key), options.accounts.map((a) => a.id)),
                  )
                }
              />

              <CheckList
                legend="Catégories"
                hint="Aucune cochée signifie « toutes ». Une opération sans catégorie sort du périmètre dès qu'une catégorie est nommée."
                testid="yd-export-category"
                items={options.categories.map((category) => ({
                  key: String(category.id),
                  id: `yd-export-category-${category.id}`,
                  label: category.name,
                }))}
                checked={(key) =>
                  categoryIds === null || categoryIds.includes(Number(key))
                }
                onToggle={(key) =>
                  setCategoryIds((current) =>
                    toggle(current, Number(key), options.categories.map((c) => c.id)),
                  )
                }
              />

              <CheckList
                legend="Modules"
                hint="Ce que le document contiendra, section par section."
                testid="yd-export-module"
                items={options.modules.map((module) => ({
                  key: module.key,
                  id: `yd-export-module-${module.key}`,
                  label: module.label,
                }))}
                checked={(key) => modules.includes(key)}
                onToggle={(key) =>
                  setModules((current) =>
                    current.includes(key)
                      ? current.filter((value) => value !== key)
                      : [...current, key],
                  )
                }
              />

              <label className="yd-scope__check yd-scope__check--switch">
                <input
                  type="checkbox"
                  id="yd-export-anonymise"
                  checked={anonymise}
                  onChange={(event) => setAnonymise(event.target.checked)}
                />
                <span>Anonymiser le document</span>
              </label>
              <p className="yd-scope__hint">
                Marchands, comptes, dettes, objectifs et instruments remplacés par des
                pseudonymes stables&nbsp;; aucun montant absolu, aucune devise. Les montants
                deviennent des parts d'une base 100 qui n'est pas communiquée.
              </p>

              <label className="yd-scope__field yd-scope__field--wide">
                <span>Modèle visé</span>
                <select
                  value={targetModel}
                  onChange={(event) => setTargetModel(event.target.value)}
                >
                  <option value="">Aucun — estimation sans verdict</option>
                  {options.target_models.map((model) => (
                    <option key={model.key} value={model.key}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.templates}
          className="yd-panel yd-export__cell--stretch"
          {...entryProps(reduced)}
        >
          <h2 className="yd-panel__title">Gabarits</h2>
          <p className="yd-export__note">
            Chacun précoche son propre périmètre et porte la question à poser au modèle.
          </p>
          <ul className="yd-templates" data-testid="yd-export-templates">
            {templates.map((template) => (
              <li key={template.key}>
                <button
                  type="button"
                  className={`yd-template${
                    applied?.key === template.key ? " yd-template--applied" : ""
                  }`}
                  data-testid={`yd-export-template-${template.key}`}
                  onClick={() => applyTemplate(template)}
                >
                  <span className="yd-template__label">{template.label}</span>
                  <span className="yd-template__summary">{template.summary}</span>
                </button>
              </li>
            ))}
          </ul>
          {applied !== null ? (
            <div className="yd-export__question-block">
              <p className="yd-export__question-label">
                Question à poser au modèle — {applied.label}
              </p>
              <p className="yd-export__question" data-testid="yd-export-question">
                {applied.question}
              </p>
              <button
                type="button"
                className="yd-export__action"
                onClick={() => void copy(applied.question, "Question copiée")}
              >
                Copier la question
              </button>
            </div>
          ) : null}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.full} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Volume et transmission</h2>

          {refusal !== null ? (
            <p className="yd-export__refusal" data-testid="yd-export-refusal">
              {refusal}
            </p>
          ) : document_ === null ? (
            <div role="status" aria-busy="true" aria-label="Mesure du document">
              <div className="yd-skeleton yd-skeleton--patrimoine-title" aria-hidden="true" />
            </div>
          ) : (
            <>
              <dl className="yd-export__facts">
                <div className="yd-fact">
                  <dt className="yd-fact__label">Volume estimé</dt>
                  <dd className="yd-fact__value" data-testid="yd-export-tokens">
                    {FR_INT.format(document_.estimated_tokens)} tokens
                  </dd>
                  <dd className="yd-fact__note">
                    Estimation, jamais une mesure&nbsp;: chaque modèle a son propre vocabulaire.
                    Yieldo compte large plutôt que juste, pour ne jamais annoncer qu'un document
                    tient dans une fenêtre qu'il dépasse.
                  </dd>
                </div>
                <div className="yd-fact">
                  <dt className="yd-fact__label">Opérations retenues</dt>
                  <dd className="yd-fact__value">
                    {FR_INT.format(document_.transaction_count)}
                  </dd>
                  <dd className="yd-fact__note">
                    Du {document_.date_from} au {document_.date_to}.{" "}
                    {document_.excluded_transfer_count > 0
                      ? `${FR_INT.format(document_.excluded_transfer_count)} virement${
                          document_.excluded_transfer_count > 1 ? "s" : ""
                        } interne${
                          document_.excluded_transfer_count > 1 ? "s" : ""
                        } exclu${document_.excluded_transfer_count > 1 ? "s" : ""} : un virement est un mouvement, pas un flux.`
                      : "Aucun virement interne sur ce périmètre."}
                  </dd>
                </div>
                <div className="yd-fact">
                  <dt className="yd-fact__label">Sections</dt>
                  <dd className="yd-fact__value yd-fact__value--words">
                    {document_.sections.length}
                  </dd>
                  <dd className="yd-fact__note">
                    {isMeasuring ? "Mesure en cours…" : "À jour du périmètre ci-contre."}
                  </dd>
                </div>
              </dl>

              {document_.warning !== null ? (
                <p className="yd-export__warning" data-testid="yd-export-warning">
                  {document_.warning}
                </p>
              ) : null}

              <div className="yd-export__actions">
                <button
                  type="button"
                  className="yd-export__action yd-export__action--primary"
                  onClick={() => void copy(document_.markdown, "Copié dans le presse-papiers")}
                >
                  Copier le document
                </button>
                {FORMATS.map((format) => (
                  <button
                    key={format.value}
                    type="button"
                    className="yd-export__action"
                    onClick={() => void download(format.value)}
                  >
                    {format.label}
                  </button>
                ))}
                {copied !== null ? (
                  <span
                    className="yd-export__copied"
                    role="status"
                    data-testid="yd-export-copied"
                  >
                    {copied}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </BentoCell>

        {document_ !== null ? (
          <BentoCell
            as={motion.div}
            span={SPAN.full}
            className="yd-panel"
            {...entryProps(reduced)}
          >
            <h2 className="yd-panel__title">Aperçu du document</h2>
            <p className="yd-export__note">
              Exactement ce qui sera copié ou téléchargé — rien n'est ajouté au moment de l'envoi.
            </p>
            <pre className="yd-export__preview" data-testid="yd-export-preview">
              {document_.markdown}
            </pre>
          </BentoCell>
        ) : null}
      </BentoGrid>
    </section>
  );
}
