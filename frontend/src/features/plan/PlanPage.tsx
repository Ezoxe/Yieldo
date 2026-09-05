import { useCallback, useEffect, useState, type FormEvent } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState, frenchDate } from "../../design/EmptyState";
import { PlanIcon, PlusIcon, RecurrencesIcon, TrashIcon } from "../../design/icons";
import { InfoTip } from "../../design/InfoTip";
import { PageHead } from "../../design/PageHead";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type {
  Category,
  PlanFromRecurrences,
  PlanKind,
  PlanLine,
  PlanPeriodicity,
  PlanPreview,
} from "../../lib/types";
import { parseAmountToCents } from "../transactions/TransactionForm";
import { LEDGER_MODE_LABELS, LEDGER_MODE_NOTES, useLedgerMode } from "./useLedgerMode";
import "./PlanPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

const SPAN = {
  intro: { base: 1, md: 6, lg: 12 },
  form: { base: 1, md: 6, lg: 5 },
  lines: { base: 1, md: 6, lg: 7 },
  preview: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

export const PERIODICITY_LABELS: Record<PlanPeriodicity, string> = {
  weekly: "Chaque semaine",
  biweekly: "Toutes les deux semaines",
  monthly: "Chaque mois",
  quarterly: "Chaque trimestre",
  yearly: "Chaque année",
  one_off: "Une seule fois",
};

const KIND_LABELS: Record<PlanKind, string> = {
  fixed: "Montant connu",
  envelope: "Enveloppe",
};

const ORIGIN_LABELS: Record<PlanLine["origin"], string> = {
  manual: "Déclarée",
  recurrence: "Depuis vos récurrences",
  agent: "Proposée par l'IA",
};

/** The rhythms a `fixed` line may take. An envelope is monthly by definition —
 *  an allowance for a quarter is a different promise, and the backend refuses
 *  it rather than reinterpreting it. */
const FIXED_PERIODICITIES: PlanPeriodicity[] = [
  "monthly", "quarterly", "yearly", "weekly", "biweekly", "one_off",
];

interface DraftState {
  label: string;
  amount: string;
  direction: "expense" | "income";
  kind: PlanKind;
  periodicity: PlanPeriodicity;
  dayOfMonth: string;
  startOn: string;
  categoryId: string;
  matchLabel: string;
}

function emptyDraft(today: Date): DraftState {
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60_000);
  return {
    label: "",
    amount: "",
    direction: "expense",
    kind: "fixed",
    periodicity: "monthly",
    dayOfMonth: "1",
    startOn: `${local.toISOString().slice(0, 7)}-01`,
    categoryId: "",
    matchLabel: "",
  };
}

/**
 * The forecast plan: what a household already knows about a month whose
 * statement does not exist yet.
 *
 * Nothing on this screen is a transaction, and the intro panel says so in the
 * first sentence — the separation is the reason the feature is trustworthy at
 * all. The reading control in the header is what turns these declarations into
 * figures; this screen is where they are written and where the arithmetic of
 * the current window is shown back.
 */
export function PlanPage() {
  const mode = useLedgerMode((state) => state.mode);

  const [lines, setLines] = useState<PlanLine[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(new Date()));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [planLines, categoryList, previewBody] = await Promise.all([
        api.get<PlanLine[]>("/plan"),
        api.get<Category[]>("/categories"),
        api.get<PlanPreview>("/plan/preview"),
      ]);
      setLines(planLines);
      setCategories(categoryList);
      setPreview(previewBody);
    } catch (err) {
      setLoadError(messageFor(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);

    const cents = parseAmountToCents(draft.amount);
    if (cents === null) {
      setFormError("Le montant doit être un nombre positif, avec au plus deux décimales.");
      return;
    }
    if (draft.label.trim() === "") {
      setFormError("Le libellé est obligatoire.");
      return;
    }
    if (draft.kind === "envelope" && draft.categoryId === "") {
      setFormError("Une enveloppe doit porter une catégorie : c'est ce contre quoi elle se vide.");
      return;
    }

    setSaving(true);
    try {
      await api.post<PlanLine>("/plan", {
        label: draft.label.trim(),
        amount_cents: draft.direction === "expense" ? -cents : cents,
        kind: draft.kind,
        category_id: draft.categoryId === "" ? null : Number(draft.categoryId),
        periodicity: draft.kind === "envelope" ? "monthly" : draft.periodicity,
        day_of_month: Number(draft.dayOfMonth) || 1,
        start_on: draft.startOn,
        match_label: draft.matchLabel.trim() === "" ? null : draft.matchLabel.trim(),
      });
      setDraft(emptyDraft(new Date()));
      await load();
    } catch (err) {
      setFormError(messageFor(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(line: PlanLine) {
    setNotice(null);
    try {
      await api.delete(`/plan/${line.id}`);
      await load();
    } catch (err) {
      setLoadError(messageFor(err));
    }
  }

  async function toggleActive(line: PlanLine) {
    setNotice(null);
    try {
      await api.patch<PlanLine>(`/plan/${line.id}`, { active: !line.active });
      await load();
    } catch (err) {
      setLoadError(messageFor(err));
    }
  }

  async function importFromRecurrences() {
    setImporting(true);
    setNotice(null);
    try {
      const body = await api.post<PlanFromRecurrences>("/plan/from-recurrences");
      const created = body.created.length;
      if (created === 0 && body.skipped === 0) {
        setNotice(
          "Aucun abonnement confirmé à reprendre : la détection ne propose que les rythmes " +
            "qu'elle a vus se répéter assez longtemps pour en être sûre.",
        );
      } else {
        setNotice(
          `${created} ${plural(created, "ligne créée", "lignes créées")}` +
            (body.skipped > 0 ? `, ${body.skipped} déjà dans le plan.` : "."),
        );
      }
      await load();
    } catch (err) {
      setNotice(messageFor(err));
    } finally {
      setImporting(false);
    }
  }

  const categoryName = (id: number | null) =>
    id === null ? null : (categories.find((category) => category.id === id)?.name ?? null);

  return (
    <section className="yd-plan">
      <PageHead
        icon={PlanIcon}
        title="Plan prévisionnel"
        actions={
          <button
            type="button"
            className="yd-plan__import"
            onClick={() => void importFromRecurrences()}
            disabled={importing}
          >
            <RecurrencesIcon />
            {importing ? "Reprise…" : "Reprendre mes abonnements détectés"}
          </button>
        }
      >
        <p>
          Ce que vous savez déjà d'un mois dont le relevé n'existe pas encore : le loyer, les
          forfaits, les abonnements. Rien ici n'est une opération — vos relevés ne sont jamais
          modifiés.
        </p>
      </PageHead>

      {loadError !== null ? (
        <p className="yd-plan__alert" role="alert">
          {loadError}
        </p>
      ) : null}
      {notice !== null ? (
        <p className="yd-plan__notice" role="status">
          {notice}
        </p>
      ) : null}

      <BentoGrid>
        <BentoCell span={SPAN.intro}>
          <PanelHead icon={PlanIcon}>Comment le plan est lu</PanelHead>
          <div className="yd-plan__modes">
            {(["real", "estimated", "blended"] as const).map((option) => (
              <div
                key={option}
                className={`yd-plan__mode${mode === option ? " yd-plan__mode--current" : ""}`}
              >
                <span className="yd-plan__mode-name">{LEDGER_MODE_LABELS[option]}</span>
                <p>{LEDGER_MODE_NOTES[option]}</p>
              </div>
            ))}
          </div>
          <p className="yd-plan__foot">
            Le mode se change dans l'en-tête, à côté de l'assistant. Les récurrences détectées, les
            anomalies et le solde de vos comptes restent toujours réels, quel que soit le mode.
          </p>
        </BentoCell>

        <BentoCell span={SPAN.form}>
          <PanelHead icon={PlusIcon}>Déclarer une ligne</PanelHead>
          <form className="yd-plan__form" onSubmit={handleSubmit}>
            <div className="yd-plan__field">
              <label htmlFor="yd-plan-label">Libellé</label>
              <input
                id="yd-plan-label"
                type="text"
                placeholder="Loyer"
                value={draft.label}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                required
              />
            </div>

            <fieldset className="yd-plan__choice">
              <legend>
                Type
                <InfoTip label="La différence entre un montant connu et une enveloppe">
                  Un <strong>montant connu</strong> est réglé d'un coup : dès qu'un relevé porte le
                  paiement correspondant, la ligne disparaît du calcul, et c'est le montant réel qui
                  compte. Une <strong>enveloppe</strong> est une allocation mensuelle pour une
                  catégorie : elle se vide au fur et à mesure de ce que vous dépensez vraiment
                  dedans, et seul ce qu'il en reste s'ajoute.
                </InfoTip>
              </legend>
              <div className="yd-plan__choice-options">
                {(["fixed", "envelope"] as const).map((kind) => (
                  <label key={kind} htmlFor={`yd-plan-kind-${kind}`}>
                    <input
                      id={`yd-plan-kind-${kind}`}
                      type="radio"
                      name="yd-plan-kind"
                      checked={draft.kind === kind}
                      onChange={() => setDraft({ ...draft, kind })}
                    />
                    <span>{KIND_LABELS[kind]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="yd-plan__choice">
              <legend>Sens</legend>
              <div className="yd-plan__choice-options">
                <label htmlFor="yd-plan-expense">
                  <input
                    id="yd-plan-expense"
                    type="radio"
                    name="yd-plan-direction"
                    checked={draft.direction === "expense"}
                    onChange={() => setDraft({ ...draft, direction: "expense" })}
                  />
                  <span>Dépense</span>
                </label>
                <label htmlFor="yd-plan-income">
                  <input
                    id="yd-plan-income"
                    type="radio"
                    name="yd-plan-direction"
                    checked={draft.direction === "income"}
                    onChange={() => setDraft({ ...draft, direction: "income" })}
                  />
                  <span>Recette</span>
                </label>
              </div>
            </fieldset>

            <div className="yd-plan__field">
              <label htmlFor="yd-plan-amount">Montant (€)</label>
              <input
                id="yd-plan-amount"
                type="text"
                inputMode="decimal"
                className="yd-num"
                placeholder="900"
                value={draft.amount}
                onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                required
              />
            </div>

            <div className="yd-plan__field">
              <label htmlFor="yd-plan-category">
                {draft.kind === "envelope" ? "Catégorie (obligatoire)" : "Catégorie"}
              </label>
              <select
                id="yd-plan-category"
                value={draft.categoryId}
                onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
              >
                <option value="">Aucune</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {draft.kind === "fixed" ? (
              <div className="yd-plan__field">
                <label htmlFor="yd-plan-periodicity">Rythme</label>
                <select
                  id="yd-plan-periodicity"
                  value={draft.periodicity}
                  onChange={(event) =>
                    setDraft({ ...draft, periodicity: event.target.value as PlanPeriodicity })
                  }
                >
                  {FIXED_PERIODICITIES.map((option) => (
                    <option key={option} value={option}>
                      {PERIODICITY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="yd-plan__field">
              <label htmlFor="yd-plan-day">Jour du mois</label>
              <input
                id="yd-plan-day"
                type="number"
                min={1}
                max={31}
                className="yd-num"
                value={draft.dayOfMonth}
                onChange={(event) => setDraft({ ...draft, dayOfMonth: event.target.value })}
              />
            </div>

            <div className="yd-plan__field">
              <label htmlFor="yd-plan-start">À partir du</label>
              <input
                id="yd-plan-start"
                type="date"
                value={draft.startOn}
                onChange={(event) => setDraft({ ...draft, startOn: event.target.value })}
                required
              />
            </div>

            {draft.kind === "fixed" ? (
              <div className="yd-plan__field">
                <label htmlFor="yd-plan-match">
                  Reconnue sur le relevé par
                  <InfoTip label="À quoi sert ce libellé de reconnaissance">
                    C'est le morceau de texte cherché dans vos relevés pour savoir si la dépense est
                    déjà passée. « Netflix » reconnaît « PRLV NETFLIX INTERNATIONAL BV ». Laissé
                    vide, la ligne se repère sur sa catégorie seule.
                  </InfoTip>
                </label>
                <input
                  id="yd-plan-match"
                  type="text"
                  placeholder="Netflix"
                  value={draft.matchLabel}
                  onChange={(event) => setDraft({ ...draft, matchLabel: event.target.value })}
                />
              </div>
            ) : null}

            {formError !== null ? (
              <p className="yd-plan__error" role="alert">
                {formError}
              </p>
            ) : null}

            <button type="submit" className="yd-plan__save" disabled={saving}>
              {saving ? "Enregistrement…" : "Ajouter au plan"}
            </button>
          </form>
        </BentoCell>

        <BentoCell span={SPAN.lines} data-ai-target="panel-plan">
          <PanelHead
            icon={PlanIcon}
            subtitle={
              lines.length > 0
                ? `${lines.length} ${plural(lines.length, "ligne", "lignes")}`
                : undefined
            }
          >
            Vos lignes
          </PanelHead>
          {isLoading ? (
            <p className="yd-plan__waiting" role="status">
              Chargement du plan…
            </p>
          ) : lines.length === 0 ? (
            <EmptyState
              title="Aucune ligne déclarée"
              detail="Le plan est vide, et c'est pour cela que les modes « Estimé » et « Réel complété » ne changent rien pour l'instant. Déclarez votre loyer, ou reprenez les abonnements que Yieldo a déjà détectés."
            />
          ) : (
            <ul className="yd-plan__lines">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className={`yd-plan__line${line.active ? "" : " yd-plan__line--off"}`}
                >
                  <div className="yd-plan__line-main">
                    <span className="yd-plan__line-label">{line.label}</span>
                    <span className="yd-plan__line-meta">
                      {KIND_LABELS[line.kind]} · {PERIODICITY_LABELS[line.periodicity]}
                      {line.kind === "fixed" ? ` · le ${line.day_of_month}` : ""}
                      {categoryName(line.category_id) !== null
                        ? ` · ${categoryName(line.category_id)}`
                        : ""}
                    </span>
                    <span className="yd-plan__line-origin">{ORIGIN_LABELS[line.origin]}</span>
                  </div>
                  <span
                    className={`yd-plan__line-amount yd-num${
                      line.amount_cents < 0 ? " yd-plan__line-amount--out" : ""
                    }`}
                  >
                    {formatCents(line.amount_cents)}
                  </span>
                  <div className="yd-plan__line-actions">
                    <button type="button" onClick={() => void toggleActive(line)}>
                      {line.active ? "Suspendre" : "Réactiver"}
                    </button>
                    <button
                      type="button"
                      className="yd-plan__line-delete"
                      onClick={() => void remove(line)}
                      aria-label={`Supprimer ${line.label}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </BentoCell>

        {preview !== null && preview.planned.length > 0 ? (
          <BentoCell span={SPAN.preview} data-ai-target="panel-plan-restant">
            <PanelHead
              icon={PlanIcon}
              subtitle={`Du ${frenchDate(preview.date_from)} au ${frenchDate(preview.date_to)}`}
            >
              Sur la période de vos données
            </PanelHead>
            <div className="yd-plan__totals">
              <div>
                <span className="yd-plan__total-label">Prévu</span>
                <span className="yd-plan__total yd-num">
                  {formatCents(preview.planned_total_cents)}
                </span>
                <span className="yd-plan__total-note">
                  {preview.planned.length}{" "}
                  {plural(preview.planned.length, "échéance", "échéances")}
                </span>
              </div>
              <div>
                <span className="yd-plan__total-label">Pas encore sur vos relevés</span>
                <span className="yd-plan__total yd-num">
                  {formatCents(preview.remaining_total_cents)}
                </span>
                <span className="yd-plan__total-note">
                  Exactement ce que « {LEDGER_MODE_LABELS.blended} » ajoute
                </span>
              </div>
            </div>
          </BentoCell>
        ) : null}
      </BentoGrid>
    </section>
  );
}
