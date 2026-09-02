import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import type { TaxAccount, TaxReport } from "../../lib/types";

/** `models/investment_account.py`'s INVESTMENT_ACCOUNT_KINDS, in French. The
 *  ENVELOPE, which is the question — never the regime, which is the answer and
 *  comes from the engine on `regime_label`. */
const KIND_LABELS: Record<string, string> = {
  pea: "PEA",
  pea_pme: "PEA-PME",
  cto: "Compte-titres ordinaire",
  assurance_vie: "Assurance-vie",
  per: "Plan d'épargne retraite",
  crypto_exchange: "Compte d'échange crypto",
  other: "Autre enveloppe",
};

/**
 * The latent capital gain inside each envelope, and what it would cost to
 * realise it today.
 *
 * **No euro figure appears without the regime that produced it.** PFU, barème,
 * the PEA's five-year exemption and assurance-vie's reduced rate are four
 * different answers to the same question, and `regime_label` — written by
 * `engines/tax_fr.py`, with its article of the CGI — is rendered on the same
 * card as the amount, never in a tooltip and never inferred here from the
 * account's kind. An envelope that could not be taxed shows NO figure at all:
 * `regime` and `total_tax_cents` arrive null together, on purpose.
 *
 * **Per envelope, never merged into one number.** A PEA past five years, a CTO
 * and an eight-year assurance-vie owe three different amounts on the same gain;
 * a single total would name none of the three.
 */
export function TaxPanel({ tax }: { tax: TaxReport }) {
  return (
    <div className="yd-tax">
      <p className="yd-projection__note">
        Ce que vous devriez si vous cédiez tout aujourd'hui — une plus-value <em>latente</em>,
        rien n'a été vendu. Chaque enveloppe est chiffrée sous son propre régime, avec l'article
        du code général des impôts qui l'applique.
      </p>

      <div className="yd-tax__totals">
        <Total label="Plus-value latente totale" value={formatCents(tax.total_unrealised_gain_cents)} />
        <Total label="Impôt total si cession aujourd'hui" value={formatCents(tax.total_tax_cents)} />
      </div>

      {tax.accounts_unavailable > 0 ? (
        <p className="yd-projection__note">
          <strong>
            {tax.accounts_unavailable === 1
              ? "1 enveloppe n'a pas pu être chiffrée"
              : `${tax.accounts_unavailable} enveloppes n'ont pas pu être chiffrées`}
          </strong>{" "}
          et n'entre{tax.accounts_unavailable === 1 ? "" : "nt"} donc pas dans les deux totaux
          ci-dessus. La raison est donnée sur chacune.
        </p>
      ) : null}

      {tax.cheaper !== null ? (
        <p className="yd-projection__note" data-testid="yd-tax-cheaper">
          Sur les enveloppes où l'option est ouverte, le total est plus faible{" "}
          <strong>{tax.cheaper === "bareme" ? "au barème progressif" : "au PFU"}</strong>. Les
          deux chiffres sont affichés côte à côte&nbsp;: Yieldo compare, il ne conseille pas.
        </p>
      ) : null}

      <ul className="yd-tax__accounts">
        {tax.accounts.map((account) => (
          <TaxAccountCard key={account.account_id} account={account} />
        ))}
      </ul>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="yd-tax__total">
      <span className="yd-tax__total-label">{label}</span>
      <span className="yd-tax__total-value">{value}</span>
    </div>
  );
}

function TaxAccountCard({ account }: { account: TaxAccount }) {
  const kind = KIND_LABELS[account.account_kind] ?? account.account_kind;

  return (
    <li className="yd-tenv">
      <div className="yd-tenv__head">
        <p className="yd-tenv__name">{account.account_name}</p>
        <p className="yd-tenv__kind">
          {kind}
          {account.opened_on !== null ? ` — ouvert le ${frenchDate(account.opened_on)}` : ""}
          {account.years_held !== null ? ` (${account.years_held} ans révolus)` : ""}
        </p>
      </div>

      {account.unavailable_reason !== null || account.regime === null ? (
        // No figure, no regime, no partial number that could be read as a bill.
        <p className="yd-projection__refusal">{account.unavailable_reason}</p>
      ) : (
        <>
          <p className="yd-tenv__regime" data-testid={`yd-tax-regime-${account.account_id}`}>
            {account.regime_label}
          </p>
          <dl className="yd-tenv__figures">
            <Figure label="Plus-value latente" value={formatCents(account.unrealised_gain_cents ?? 0)} />
            <Figure label="Impôt sur le revenu" value={formatCents(account.income_tax_cents ?? 0)} />
            <Figure label="Prélèvements sociaux" value={formatCents(account.social_levies_cents ?? 0)} />
            <Figure label="Total dû" value={formatCents(account.total_tax_cents ?? 0)} strong />
            <Figure label="Net après impôt" value={formatCents(account.net_gain_cents ?? 0)} />
          </dl>
          {account.exempt === true ? (
            <p className="yd-projection__note">
              L'exonération porte sur l'impôt sur le revenu seulement. Les prélèvements sociaux de
              17,20 % restent dus dans tous les cas.
            </p>
          ) : null}
          {account.abatement_applied_cents !== null && account.abatement_applied_cents > 0 ? (
            <p className="yd-projection__note">
              Abattement appliqué&nbsp;:{" "}
              <strong>{formatCents(account.abatement_applied_cents)}</strong>, sur la base
              imposable à l'impôt sur le revenu uniquement — les prélèvements sociaux restent
              calculés sur la plus-value brute entière.
            </p>
          ) : null}
          {account.alternative !== null ? (
            <div className="yd-tenv__alternative">
              <p className="yd-tenv__alternative-title">Si vous optiez pour le barème</p>
              <p className="yd-tenv__regime">{account.alternative.regime_label}</p>
              <dl className="yd-tenv__figures">
                <Figure label="Impôt sur le revenu" value={formatCents(account.alternative.income_tax_cents)} />
                <Figure label="Prélèvements sociaux" value={formatCents(account.alternative.social_levies_cents)} />
                <Figure label="Total dû" value={formatCents(account.alternative.total_tax_cents)} strong />
              </dl>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="yd-tfig">
      <dt className="yd-tfig__label">{label}</dt>
      <dd className={`yd-tfig__value${strong ? " yd-tfig__value--strong" : ""}`}>{value}</dd>
    </div>
  );
}
