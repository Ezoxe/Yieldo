import { useEffect, useState } from "react";

import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { BalanceBreakdown as Breakdown } from "../../lib/types";
import "./BalanceBreakdown.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

const KIND_LABELS: Record<string, string> = {
  checking: "Compte courant",
  savings: "Livret",
  cash: "Espèces",
  brokerage: "Compte-titres",
  pea: "PEA",
  life_insurance: "Assurance-vie",
  crypto: "Crypto",
  property: "Bien immobilier",
  other: "Autre",
};

/**
 * How much of a lopsided flag is worth a word, in cents.
 *
 * Not zero: a rounding difference of a few euros between the two legs of a
 * transfer (a fee taken on the way, a receipt a day late and a cent short) is
 * noise, and a warning that fires on 0,03 EUR would be dismissed before the one
 * that matters is ever read. Fifty euros is the point at which the difference
 * is a movement rather than a rounding.
 */
export const UNMATCHED_TOLERANCE_CENTS = 5_000;

/** What a lopsided transfer flag does to the figures, in one sentence — or null
 *  when the two legs cancel and there is nothing to say. */
export function unmatchedSentence(unmatched: number): string | null {
  if (Math.abs(unmatched) < UNMATCHED_TOLERANCE_CENTS) return null;
  const amount = formatCents(Math.abs(unmatched));
  return unmatched > 0
    ? `${amount} de virements internes sont marqués à la réception sans que l'envoi correspondant le soit. Ces montants sont comptés comme des revenus et jamais comme des dépenses : vos revenus mesurés et votre capacité d'épargne sont donc surestimés d'autant.`
    : `${amount} de virements internes sont marqués à l'envoi sans que la réception correspondante le soit. Ces montants sont comptés comme des revenus alors que la sortie ne l'est pas : vos revenus mesurés sont surestimés d'autant.`;
}

/**
 * Where the solde comes from, account by account.
 *
 * The application answers one number — opening balances plus every movement
 * over every liquid account — and a household that does not recognise it has
 * nothing to check it against. Every way that figure can be wrong looks
 * identical from the outside: a statement imported twice under two accounts, an
 * opening balance typed as today's balance on top of a backfilled history, a
 * savings account declared but never imported. Split into its two halves per
 * account, each of them is obvious on sight.
 *
 * The transfer audit is the other half of the same complaint. A transfer has
 * two legs and they cancel; the measured rates drop every flagged row while the
 * balance keeps them, so a receipt flagged without its emission is counted as
 * income that was never spent — "on dirait qu'il prend mes revenus sans prendre
 * en compte les dépenses", exactly.
 */
export function BalanceBreakdown() {
  const [data, setData] = useState<Breakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await api.get<Breakdown>("/accounts/balance");
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    // `status`, not `alert`: the figure above is fine and only its working-out
    // failed to load, so this is reported without interrupting a reader -- and
    // without joining the page's own alerts, which announce a failed answer.
    return (
      <p className="yd-balance__error" role="status">
        {`Le détail du solde n'a pas pu être chargé : ${error}`}
      </p>
    );
  }
  if (data === null) return null;

  const warning = unmatchedSentence(data.transfers.unmatched_cents);

  return (
    <details className="yd-balance">
      <summary className="yd-balance__summary">D'où vient ce solde</summary>

      <table className="yd-balance__table">
        <thead>
          <tr>
            <th scope="col">Compte</th>
            <th scope="col">Solde initial</th>
            <th scope="col">Mouvements</th>
            <th scope="col">Solde</th>
          </tr>
        </thead>
        <tbody>
          {data.accounts.map((account) => (
            <tr key={account.id} className={account.liquid ? undefined : "yd-balance__row--excluded"}>
              <th scope="row">
                <span className="yd-balance__name">{account.name}</span>
                <span className="yd-balance__kind">
                  {KIND_LABELS[account.kind] ?? account.kind}
                  {account.liquid ? "" : " · hors solde disponible"}
                </span>
              </th>
              <td className="yd-num">{formatCents(account.opening_balance_cents, { signed: true })}</td>
              <td className="yd-num">
                {formatCents(account.movements_cents, { signed: true })}
                <span className="yd-balance__count">
                  {` (${account.transaction_count} ${plural(account.transaction_count, "opération", "opérations")})`}
                </span>
              </td>
              <td className="yd-num">{formatCents(account.balance_cents, { signed: true })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total disponible</th>
            <td />
            <td />
            <td className="yd-num">{formatCents(data.liquid_total_cents, { signed: true })}</td>
          </tr>
        </tfoot>
      </table>

      <p className="yd-balance__note">
        Le solde initial est celui que vous avez déclaré à la création du compte. S'il portait déjà
        le solde du jour et que vous avez ensuite importé l'historique, il est compté deux fois —
        corrigez-le dans Réglages → Comptes.
      </p>

      {warning !== null ? (
        <p className="yd-balance__warning" role="status">
          {warning}
        </p>
      ) : null}
    </details>
  );
}
