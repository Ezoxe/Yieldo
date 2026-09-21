import { useEffect, useState } from "react";

import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { InfoTip } from "../../design/InfoTip";
import { PageHead } from "../../design/PageHead";
import { PageSkeleton } from "../../design/PageSkeleton";
import { HaltIcon, MandateIcon, OversightIcon } from "../../design/icons";
import { parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { useApiQuery, useInvalidate } from "../../lib/useApiQuery";
import type { InvestAutonomy, InvestPolicy } from "../../lib/types";
import { formatBps, formatCents, remainingMinutes } from "./format";
import { AUTONOMY_EXPLAINED, AUTONOMY_LABELS } from "./vocabulary";
import "./invest.css";

/**
 * The phrase that opens real money to software.
 *
 * Kept in sync with `api/invest_policy.ARM_PHRASE` by
 * `MandatePage.test.tsx`, which reads the Python constant off disk: two
 * spellings of this string is a confirmation nobody can pass.
 */
export const ARM_PHRASE = "JE CONFIRME L'EXECUTION REELLE";

const AUTONOMIES: InvestAutonomy[] = ["observer", "paper", "live"];

/**
 * Cents in, euros in a French field, cents back out.
 *
 * Integer arithmetic and a decimal COMMA. `toFixed(2)` was here first and put
 * « 2000.00 » in every money field of a French interface — a defect on screen
 * before it is anything else. `parseCents` reads a comma or a dot, so nothing
 * downstream changes; what changes is that the field now shows the reader the
 * notation they are expected to type.
 *
 * No thousands separator on purpose: this is an editable field, and a value
 * the reader has to un-group before editing is worse than an ungrouped one.
 * The read-only figures on these screens go through `formatCents`, which does
 * group them.
 */
function euros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.trunc(Math.abs(cents) / 100);
  const fraction = Math.abs(cents) % 100;
  return `${sign}${whole},${String(fraction).padStart(2, "0")}`;
}

/** A rate in basis points as a French percentage for an editable field. */
function percent(bps: number): string {
  const whole = Math.trunc(Math.abs(bps) / 100);
  const fraction = Math.abs(bps) % 100;
  const sign = bps < 0 ? "-" : "";
  return fraction === 0
    ? `${sign}${whole}`
    : `${sign}${whole},${String(fraction).padStart(2, "0")}`;
}

interface Draft {
  max_position: string;
  max_exposure: string;
  max_order_notional: string;
  min_order_notional: string;
  max_daily_loss: string;
  min_cash_buffer: string;
  max_drawdown_bps: string;
  max_orders_per_day: string;
  allowed_symbols: string;
  allow_short: boolean;
  allow_leverage: boolean;
  allow_limit_orders: boolean;
  minimum_conviction: string;
  minimum_probability_bps: string;
  max_volatility_bps: string;
  full_conviction_share_bps: string;
  autonomy: InvestAutonomy;
}

function toDraft(policy: InvestPolicy): Draft {
  return {
    max_position: euros(policy.max_position_cents),
    max_exposure: euros(policy.max_exposure_cents),
    max_order_notional: euros(policy.max_order_notional_cents),
    min_order_notional: euros(policy.min_order_notional_cents),
    max_daily_loss: euros(policy.max_daily_loss_cents),
    min_cash_buffer: euros(policy.min_cash_buffer_cents),
    max_drawdown_bps: percent(policy.max_drawdown_bps),
    max_orders_per_day: String(policy.max_orders_per_day),
    allowed_symbols: policy.allowed_symbols.join(", "),
    allow_short: policy.allow_short,
    allow_leverage: policy.allow_leverage,
    allow_limit_orders: policy.allow_limit_orders,
    minimum_conviction: String(policy.minimum_conviction),
    minimum_probability_bps: percent(policy.minimum_probability_bps),
    max_volatility_bps: percent(policy.max_volatility_bps),
    full_conviction_share_bps: percent(policy.full_conviction_share_bps),
    autonomy: policy.autonomy,
  };
}

function percentToBps(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * The mandate: everything the household authorises, in figures.
 *
 * Every ceiling on this screen is enforced by `engines/trading_risk`, which no
 * order can go round. What the screen adds is the ability to read them all at
 * once — a limit you cannot see beside the others is a limit you set once and
 * never reconsider.
 *
 * The arming sits at the bottom, in its own panel, behind a typed phrase. It
 * is the only control in Yieldo that requires one, and it is the only one
 * whose effect expires on its own.
 */
export function MandatePage() {
  const policy = useApiQuery<InvestPolicy>("/invest/policy");
  const invalidate = useInvalidate();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [minutes, setMinutes] = useState("30");

  useEffect(() => {
    if (policy.data && draft === null) setDraft(toDraft(policy.data));
  }, [policy.data, draft]);

  if (policy.isPending || draft === null) return <PageSkeleton />;
  if (policy.error) {
    return (
      <div className="yd-invest-page">
        <PageHead icon={MandateIcon} title="Mandat" />
        <p className="yd-note yd-note--negative">{policy.error.detail}</p>
      </div>
    );
  }

  const current = policy.data;
  const armedMinutes = remainingMinutes(current.armed_until);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put("/invest/policy", {
        max_position_cents: parseCents(draft.max_position) ?? 0,
        max_exposure_cents: parseCents(draft.max_exposure) ?? 0,
        max_order_notional_cents: parseCents(draft.max_order_notional) ?? 0,
        min_order_notional_cents: parseCents(draft.min_order_notional) ?? 0,
        max_daily_loss_cents: parseCents(draft.max_daily_loss) ?? 0,
        min_cash_buffer_cents: parseCents(draft.min_cash_buffer) ?? 0,
        max_drawdown_bps: percentToBps(draft.max_drawdown_bps),
        max_orders_per_day: Number(draft.max_orders_per_day) || 0,
        allowed_symbols: draft.allowed_symbols
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
        allow_short: draft.allow_short,
        allow_leverage: draft.allow_leverage,
        allow_limit_orders: draft.allow_limit_orders,
        minimum_conviction: Number(draft.minimum_conviction) || 0,
        minimum_probability_bps: percentToBps(draft.minimum_probability_bps),
        max_volatility_bps: percentToBps(draft.max_volatility_bps),
        full_conviction_share_bps: percentToBps(draft.full_conviction_share_bps),
        autonomy: draft.autonomy,
      });
      await invalidate("/invest/policy");
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : "Le mandat n'a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  };

  const arm = async () => {
    setError(null);
    try {
      await api.post("/invest/policy/arm", {
        confirmation,
        minutes: Number(minutes) || 30,
      });
      setConfirmation("");
      await invalidate("/invest/policy");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : "L'armement a échoué.");
    }
  };

  const disarm = async () => {
    await api.post("/invest/policy/disarm", {});
    await invalidate("/invest/policy");
  };

  return (
    <div className="yd-invest-page">
      <PageHead
        icon={MandateIcon}
        title="Mandat"
        shortLead="Ce que le pilote a le droit de faire, en chiffres."
      >
        <p>
          Aucun ordre ne part sans être passé par ces limites. Une règle de permission —
          instrument hors liste, sens interdit, exécution non armée — refuse&nbsp;; une limite
          de taille réduit l'ordre à ce qu'elle autorise, et ne le refuse que s'il ne reste
          plus rien.
        </p>
      </PageHead>

      {current.halted ? (
        <div className="yd-note yd-note--negative" role="status">
          <HaltIcon /> Le pilotage est à l'arrêt&nbsp;:{" "}
          {current.halted_reason ?? "sans raison enregistrée"}. Relancez-le depuis la Salle de
          contrôle avant d'armer quoi que ce soit.
        </div>
      ) : null}

      <BentoGrid>
        <BentoCell span={{ base: 1, md: 6, lg: 7 }}>
          <PanelHead icon={MandateIcon}>Les limites</PanelHead>
          <div className="yd-invest-form">
            <label className="yd-invest-field">
              <span>Instruments autorisés</span>
              <input
                className="yd-input"
                value={draft.allowed_symbols}
                onChange={(event) => set("allowed_symbols", event.target.value)}
                placeholder="BTC-EUR, AAPL"
              />
              <small>
                Séparés par des virgules, écrits comme le courtier les écrit. <strong>Une
                liste vide n'autorise rien</strong> — jamais tout.
              </small>
            </label>

            <div className="yd-invest-grid">
              <label className="yd-invest-field">
                <span>Plafond par position (€)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.max_position}
                       onChange={(event) => set("max_position", event.target.value)} />
              </label>
              <label className="yd-invest-field">
                <span>Plafond d'exposition (€)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.max_exposure}
                       onChange={(event) => set("max_exposure", event.target.value)} />
              </label>
              <label className="yd-invest-field">
                <span>Plafond par ordre (€)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.max_order_notional}
                       onChange={(event) => set("max_order_notional", event.target.value)} />
              </label>
              <label className="yd-invest-field">
                <span>Montant minimal par ordre (€)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.min_order_notional}
                       onChange={(event) => set("min_order_notional", event.target.value)} />
                <small>
                  Sous ce montant l'ordre est refusé plutôt que transmis&nbsp;: quelques
                  centimes paient un écart de cotation pour une position qui ne change rien.
                </small>
              </label>
              <label className="yd-invest-field">
                <span>Perte maximale du jour (€)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.max_daily_loss}
                       onChange={(event) => set("max_daily_loss", event.target.value)} />
                <small>
                  Atteinte, plus aucune position n'est ouverte. Les ventes qui réduisent le
                  risque restent possibles.
                </small>
              </label>
              <label className="yd-invest-field">
                <span>Réserve de liquidités (€)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.min_cash_buffer}
                       onChange={(event) => set("min_cash_buffer", event.target.value)} />
              </label>
              <label className="yd-invest-field">
                <span>Repli maximal (%)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.max_drawdown_bps}
                       onChange={(event) => set("max_drawdown_bps", event.target.value)} />
                <small>Mesuré depuis le plus haut atteint par le capital.</small>
              </label>
              <label className="yd-invest-field">
                <span>Ordres maximum par jour</span>
                <input className="yd-input yd-num" inputMode="numeric"
                       value={draft.max_orders_per_day}
                       onChange={(event) => set("max_orders_per_day", event.target.value)} />
              </label>
            </div>

            <label className="yd-invest-check">
              <input type="checkbox" checked={draft.allow_short}
                     onChange={(event) => set("allow_short", event.target.checked)} />
              <span>Autoriser la vente à découvert</span>
            </label>
            <label className="yd-invest-check">
              <input type="checkbox" checked={draft.allow_leverage}
                     onChange={(event) => set("allow_leverage", event.target.checked)} />
              <span>Autoriser l'effet de levier</span>
            </label>
            <label className="yd-invest-check">
              <input type="checkbox" checked={draft.allow_limit_orders}
                     onChange={(event) => set("allow_limit_orders", event.target.checked)} />
              <span>Autoriser les ordres à cours limité</span>
            </label>
          </div>
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 5 }}>
          <PanelHead
            icon={OversightIcon}
            actions={
              <InfoTip label="Quand une réponse vaut un ordre">
                Le modèle donne un sens, une conviction de 0 à 10 et une probabilité que le
                mouvement se poursuive. Ces seuils décident à partir de quand cette réponse
                est jugée assez nette pour dimensionner une position. Une conviction minimale
                de 11 regarde sans jamais rien faire.
              </InfoTip>
            }
          >
            Quand agir
          </PanelHead>
          <div className="yd-invest-form">
            <div className="yd-invest-grid">
              <label className="yd-invest-field">
                <span>Conviction minimale (0–10)</span>
                <input className="yd-input yd-num" inputMode="numeric"
                       value={draft.minimum_conviction}
                       onChange={(event) => set("minimum_conviction", event.target.value)} />
              </label>
              <label className="yd-invest-field">
                <span>Probabilité minimale (%)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.minimum_probability_bps}
                       onChange={(event) => set("minimum_probability_bps", event.target.value)} />
              </label>
              <label className="yd-invest-field">
                <span>Volatilité maximale (%)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.max_volatility_bps}
                       onChange={(event) => set("max_volatility_bps", event.target.value)} />
                <small>Au-dessus, l'instrument est écarté sans consulter le modèle.</small>
              </label>
              <label className="yd-invest-field">
                <span>Engagement à conviction 10 (%)</span>
                <input className="yd-input yd-num" inputMode="decimal"
                       value={draft.full_conviction_share_bps}
                       onChange={(event) => set("full_conviction_share_bps", event.target.value)} />
                <small>
                  La part du plafond par position qu'une conviction maximale engage.
                </small>
              </label>
            </div>

            <fieldset className="yd-invest-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>Mode de pilotage</legend>
              {AUTONOMIES.map((value) => (
                <label key={value} className="yd-invest-check">
                  <input
                    type="radio"
                    name="autonomy"
                    value={value}
                    checked={draft.autonomy === value}
                    onChange={() => set("autonomy", value)}
                  />
                  <span>
                    <strong>{AUTONOMY_LABELS[value]}</strong>
                    <br />
                    <small>{AUTONOMY_EXPLAINED[value]}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        </BentoCell>

        <BentoCell span={{ base: 1, md: 6, lg: 12 }}>
          <PanelHead icon={MandateIcon}>Les règles que le modèle ne peut pas contourner</PanelHead>
          <ul className="yd-rules">
            {current.declared_rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </BentoCell>
      </BentoGrid>

      <div className="yd-invest-actions">
        <button type="button" className="yd-button yd-button--primary"
                onClick={() => void save()} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer le mandat"}
        </button>
        {saved ? <span className="yd-note">Mandat enregistré.</span> : null}
      </div>

      {error ? <p className="yd-note yd-note--negative" role="alert">{error}</p> : null}

      <BentoGrid>
        <BentoCell span={{ base: 1, md: 6, lg: 12 }}>
          <PanelHead icon={HaltIcon}>Armer l'exécution réelle</PanelHead>
          {current.armed && armedMinutes !== null ? (
            <>
              <p className="yd-note yd-note--positive">
                L'exécution réelle est armée&nbsp;; il reste environ {armedMinutes} minute(s).
              </p>
              <div className="yd-invest-actions">
                <button type="button" className="yd-button" onClick={() => void disarm()}>
                  Désarmer maintenant
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="yd-note">
                Tant que l'exécution n'est pas armée, un mandat en mode réel refuse chaque
                ordre. L'armement <strong>expire tout seul</strong> au bout du délai choisi,
                et un arrêt d'urgence le désarme immédiatement.
              </p>
              <div className="yd-invest-grid">
                <label className="yd-invest-field">
                  <span>Tapez exactement&nbsp;: {ARM_PHRASE}</span>
                  <input
                    className="yd-input"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="yd-invest-field">
                  <span>Durée (minutes)</span>
                  <input className="yd-input yd-num" inputMode="numeric" value={minutes}
                         onChange={(event) => setMinutes(event.target.value)} />
                </label>
              </div>
              <div className="yd-invest-actions">
                <button
                  type="button"
                  className="yd-button yd-button--danger"
                  onClick={() => void arm()}
                  disabled={confirmation.trim() !== ARM_PHRASE || current.halted}
                >
                  Armer pour {minutes || 30} minute(s)
                </button>
              </div>
            </>
          )}
          <p className="yd-note yd-push-down">
            Exposition maximale autorisée en ce moment&nbsp;:{" "}
            {formatCents(current.max_exposure_cents)}, par position{" "}
            {formatCents(current.max_position_cents)}, repli toléré{" "}
            {formatBps(current.max_drawdown_bps)}.
          </p>
        </BentoCell>
      </BentoGrid>
    </div>
  );
}
