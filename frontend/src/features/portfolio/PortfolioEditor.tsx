import { useState } from "react";

import { frenchDate } from "../../design/EmptyState";
import { formatCents, formatQuantity } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { InvestmentAccount, Lot, PositionValuation } from "../../lib/types";
import { AccountForm, accountKindLabel } from "./AccountForm";
import { assetClassLabel } from "./HoldingsPanel";
import { LotForm } from "./LotForm";
import { PositionForm } from "./PositionForm";
import { sumQuantities } from "./quantity";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** "unité"/"unités" for a quantity carried as a string — the integer part
 *  alone decides, read as an integer, never the whole 18-decimal value
 *  through `Number`. */
function units(quantity: string): string {
  const [whole = "0"] = quantity.split(".");
  return plural(Number(whole), "unité", "unités");
}

/**
 * What archiving an account actually costs, in the number that applies.
 *
 * `DELETE /portfolio/accounts/{id}` sets `archived` and nothing else: the
 * positions the envelope holds are neither deleted nor changed. But they DO
 * stop counting — `engines.portfolio` values only positions under an active
 * envelope, so an archived account's holdings drop out of every total and
 * every weight on `/patrimoine` until the account is restored. Promising
 * that the positions themselves disappear would still be wrong — nothing is
 * deleted — but so would claiming they keep being valued, which is what this
 * sentence said before the valuation was fixed to actually exclude them.
 */
function archiveQuestion(name: string, positionCount: number): string {
  if (positionCount === 0) {
    return `Archiver « ${name} » ? Le compte quitte cette liste ; il ne détient aucune position. Archiver n'efface rien, et le compte reste réactivable.`;
  }
  if (positionCount === 1) {
    return `Archiver « ${name} » ? Le compte quitte cette liste, et la position qu'il détient cesse d'être comptée dans le total tant que le compte n'est pas réactivé. Rien n'est effacé : la position reste déclarée.`;
  }
  return `Archiver « ${name} » ? Le compte quitte cette liste, et les ${positionCount} positions qu'il détient cessent d'être comptées dans le total tant que le compte n'est pas réactivé. Rien n'est effacé : elles restent déclarées.`;
}

type Editing =
  | { kind: "account"; account?: InvestmentAccount }
  | { kind: "position"; accountId: number }
  | { kind: "lot"; positionId: number; symbol: string; lot?: Lot }
  | null;

type Pending =
  | { kind: "account"; id: number; question: string }
  | { kind: "position"; id: number; question: string }
  | { kind: "lot"; id: number; question: string }
  | null;

const ENDPOINT: Record<"account" | "position" | "lot", string> = {
  account: "/portfolio/accounts",
  position: "/portfolio/positions",
  lot: "/portfolio/lots",
};

interface PortfolioEditorProps {
  accounts: InvestmentAccount[];
  /** Archived envelopes — `GET /portfolio/accounts?archived=true`. Not in
   *  `accounts` and not in the valuation any more (see `archiveQuestion`),
   *  but not gone: this is the un-archive path, the only place a household
   *  can find one again to restore it. */
  archivedAccounts: InvestmentAccount[];
  /** The positions as the valuation returns them — one place the symbol, the
   *  name and the asset class are already resolved, so this panel and the
   *  holdings table above it can never disagree about what a position is.
   *  Never includes a position under an archived account: the valuation
   *  excludes those entirely, so there is no "orphan" case to render here
   *  any more. */
  positions: PositionValuation[];
  lots: Lot[];
  /** Something was created, amended or removed: the page reloads everything,
   *  because a lot changes a total, a weight and a drift at once. */
  onChanged: () => void;
}

/**
 * Where a household actually declares what it holds.
 *
 * `/patrimoine` shipped read-only: it named the three things a position needs
 * — an envelope, an instrument, a lot per acquisition — and offered no way to
 * create any of them. This panel is that way, and it is built around the one
 * structural fact the screen has to teach: **a position stores no quantity**.
 * Every total here is printed with the count of lots it was derived from,
 * beside it, in the same sentence.
 *
 * Destructive actions ask first, and the question says what is actually lost:
 * archiving an account deletes nothing but stops its positions from being
 * counted until it is restored -- see the "Comptes archivés" panel below for
 * that restore path -- deleting a position takes its lots with it at the
 * database level, deleting a lot changes the position's quantity. A refusal
 * from the API is shown where the action was, never swallowed into a silent
 * no-op.
 */
export function PortfolioEditor({
  accounts,
  archivedAccounts,
  positions,
  lots,
  onChanged,
}: PortfolioEditorProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const lotsOf = (positionId: number) => lots.filter((lot) => lot.position_id === positionId);

  async function confirmPending() {
    if (pending === null) return;
    try {
      await api.delete(`${ENDPOINT[pending.kind]}/${pending.id}`);
      setPending(null);
      setError(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    }
  }

  async function restoreAccount(accountId: number) {
    setRestoringId(accountId);
    try {
      await api.patch(`/portfolio/accounts/${accountId}`, { archived: false });
      setError(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setRestoringId(null);
    }
  }

  function saved() {
    setEditing(null);
    setError(null);
    onChanged();
  }

  function confirmation() {
    if (pending === null) return null;
    return (
      <div className="yd-editor__confirm">
        <p className="yd-editor__confirm-question">{pending.question}</p>
        <div className="yd-editor__confirm-actions">
          <button
            type="button"
            className="yd-editor__action yd-editor__action--danger"
            onClick={() => void confirmPending()}
          >
            Confirmer
          </button>
          <button type="button" className="yd-editor__action" onClick={() => setPending(null)}>
            Annuler
          </button>
        </div>
      </div>
    );
  }

  function renderLot(lot: Lot, positionLots: Lot[], symbol: string) {
    const remaining = positionLots.length - 1;
    return (
      <li className="yd-elot" key={lot.id} data-testid={`yd-editor-lot-${lot.id}`}>
        <span
          className="yd-elot__quantity"
          data-testid={`yd-editor-lot-quantity-${lot.id}`}
        >
          {/* A quantity, through `formatQuantity`. Never `formatCents`: 12
              shares through a money formatter read "0,12 €". */}
          {`${formatQuantity(lot.quantity)} ${units(lot.quantity)}`}
        </span>
        <span className="yd-elot__cost">{`${formatCents(lot.unit_cost_cents)} l'unité`}</span>
        <span className="yd-elot__date">{frenchDate(lot.acquired_on)}</span>
        <span className="yd-elot__actions">
          <button
            type="button"
            className="yd-editor__action"
            onClick={() => setEditing({ kind: "lot", positionId: lot.position_id, symbol, lot })}
          >
            <span className="sr-only">{`Modifier le lot du ${frenchDate(lot.acquired_on)}`}</span>
            <span aria-hidden="true">Modifier</span>
          </button>
          <button
            type="button"
            className="yd-editor__action"
            onClick={() =>
              setPending({
                kind: "lot",
                id: lot.id,
                question:
                  remaining === 0
                    ? `Supprimer le lot du ${frenchDate(lot.acquired_on)} ? La position n'en comptera plus aucun et ne détiendra plus rien.`
                    : `Supprimer le lot du ${frenchDate(lot.acquired_on)} ? La position en comptera ${remaining} au lieu de ${positionLots.length}, et sa quantité changera d'autant.`,
              })
            }
          >
            <span className="sr-only">{`Supprimer le lot du ${frenchDate(lot.acquired_on)}`}</span>
            <span aria-hidden="true">Supprimer</span>
          </button>
        </span>
      </li>
    );
  }

  function renderPosition(position: PositionValuation) {
    const positionLots = lotsOf(position.position_id);
    const total = sumQuantities(positionLots.map((lot) => lot.quantity));
    const isEditingLot =
      editing?.kind === "lot" && editing.positionId === position.position_id;

    return (
      <li
        className="yd-eposition"
        key={position.position_id}
        data-testid={`yd-editor-position-${position.position_id}`}
      >
        <div className="yd-eposition__head">
          <h4 className="yd-eposition__symbol">{position.symbol}</h4>
          <span className="yd-eposition__name">{position.name}</span>
          <span className="yd-eposition__class">{assetClassLabel(position.asset_class)}</span>
        </div>

        {positionLots.length === 0 ? (
          <p className="yd-eposition__empty">
            Aucun lot déclaré : cette position ne détient encore rien tant qu'une acquisition n'y
            est pas enregistrée.
          </p>
        ) : (
          <p className="yd-eposition__derived">
            <span className="yd-eposition__quantity">
              {`${formatQuantity(total)} ${units(total)}`}
            </span>
            <span className="yd-eposition__basis">
              {`somme de ${positionLots.length} ${plural(positionLots.length, "lot", "lots")}`}
            </span>
          </p>
        )}

        {positionLots.length > 0 ? (
          <ul className="yd-elots">
            {positionLots.map((lot) => renderLot(lot, positionLots, position.symbol))}
          </ul>
        ) : null}

        {isEditingLot ? (
          <LotForm
            key={editing.lot?.id ?? "new"}
            positionId={position.position_id}
            symbol={position.symbol}
            lot={editing.lot}
            siblings={positionLots}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="yd-eposition__actions">
            <button
              type="button"
              className="yd-editor__action"
              onClick={() =>
                setEditing({
                  kind: "lot",
                  positionId: position.position_id,
                  symbol: position.symbol,
                })
              }
            >
              {`Ajouter un lot`}
              <span className="sr-only">{` sur ${position.symbol}`}</span>
            </button>
            <button
              type="button"
              className="yd-editor__action"
              onClick={() =>
                setPending({
                  kind: "position",
                  id: position.position_id,
                  question:
                    positionLots.length === 0
                      ? `Supprimer la position ${position.symbol} ? Elle ne détient aucun lot ; la suppression est définitive.`
                      : `Supprimer la position ${position.symbol} ? Ses ${positionLots.length} ${plural(positionLots.length, "lot est supprimé", "lots sont supprimés")} avec elle, définitivement.`,
                })
              }
            >
              {`Supprimer la position`}
              <span className="sr-only">{` ${position.symbol}`}</span>
            </button>
          </div>
        )}
      </li>
    );
  }

  function renderAccount(account: InvestmentAccount) {
    const own = positions.filter((position) => position.account_id === account.id);
    const isEditingAccount = editing?.kind === "account" && editing.account?.id === account.id;
    const isDeclaring = editing?.kind === "position" && editing.accountId === account.id;

    return (
      <section
        className="yd-eaccount"
        key={account.id}
        data-testid={`yd-editor-account-${account.id}`}
      >
        <div className="yd-eaccount__head">
          <h3 className="yd-eaccount__name">{account.name}</h3>
          <p className="yd-eaccount__meta">
            <span data-testid={`yd-editor-account-kind-${account.id}`}>
              {accountKindLabel(account.kind)}
            </span>
            <span className="yd-eaccount__sep" aria-hidden="true">
              ·
            </span>
            <span>{account.currency}</span>
            <span className="yd-eaccount__sep" aria-hidden="true">
              ·
            </span>
            <span>
              {account.opened_on === null
                ? "date d'ouverture non renseignée"
                : `ouvert le ${frenchDate(account.opened_on)}`}
            </span>
          </p>
          <div className="yd-eaccount__actions">
            <button
              type="button"
              className="yd-editor__action"
              onClick={() => setEditing({ kind: "account", account })}
            >
              <span className="sr-only">{`Modifier ${account.name}`}</span>
              <span aria-hidden="true">Modifier</span>
            </button>
            <button
              type="button"
              className="yd-editor__action"
              onClick={() =>
                setPending({
                  kind: "account",
                  id: account.id,
                  // Truthful about what archiving does and does not do: the
                  // API sets `archived` and nothing else, so nothing is
                  // deleted -- but the valuation now excludes an archived
                  // envelope's positions from every total until it is
                  // restored. Written out per count rather than through a
                  // plural helper, because French changes more than one word
                  // between the three.
                  question: archiveQuestion(account.name, own.length),
                })
              }
            >
              <span className="sr-only">{`Archiver ${account.name}`}</span>
              <span aria-hidden="true">Archiver</span>
            </button>
          </div>
        </div>

        {isEditingAccount ? (
          <AccountForm
            account={account}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        ) : null}

        {own.length > 0 ? (
          <ul className="yd-epositions">{own.map(renderPosition)}</ul>
        ) : (
          <p className="yd-eaccount__empty">
            Aucune position dans cette enveloppe pour l'instant.
          </p>
        )}

        {isDeclaring ? (
          <PositionForm
            accounts={accounts}
            accountId={account.id}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button
            type="button"
            className="yd-editor__action yd-eaccount__add"
            onClick={() => setEditing({ kind: "position", accountId: account.id })}
          >
            {`Déclarer une position`}
            <span className="sr-only">{` dans ${account.name}`}</span>
          </button>
        )}
      </section>
    );
  }

  return (
    <div className="yd-editor">
      <p className="yd-patrimoine__note">
        Yieldo ne se connecte à aucun courtier et ne découvre rien tout seul : tout ce qui suit est
        déclaré par vous, et tout ce qui suit est modifiable.
      </p>

      {error !== null ? (
        <p role="alert" className="yd-patrimoine__alert">
          {error}
        </p>
      ) : null}

      {confirmation()}

      {accounts.length === 0 ? (
        <p className="yd-editor__empty">
          Aucun compte d'investissement : une position se déclare dans une enveloppe, alors
          commencez par en créer une — PEA, CTO, assurance-vie, PER ou plateforme d'échange.
        </p>
      ) : (
        accounts.map(renderAccount)
      )}

      {archivedAccounts.length > 0 ? (
        <section className="yd-eaccount" data-testid="yd-editor-archived">
          <div className="yd-eaccount__head">
            <h3 className="yd-eaccount__name">
              {plural(archivedAccounts.length, "Compte archivé", "Comptes archivés")}
            </h3>
            <p className="yd-eaccount__meta">
              {plural(
                archivedAccounts.length,
                "Son enveloppe a quitté le total ci-dessus, mais rien de ce qu'elle détient n'a été effacé.",
                "Leurs enveloppes ont quitté le total ci-dessus, mais rien de ce qu'elles détiennent n'a été effacé.",
              )}
            </p>
          </div>
          <ul className="yd-epositions">
            {archivedAccounts.map((account) => (
              <li
                className="yd-eposition"
                key={account.id}
                data-testid={`yd-editor-archived-account-${account.id}`}
              >
                <div className="yd-eposition__head">
                  <h4 className="yd-eposition__symbol">{account.name}</h4>
                  <span className="yd-eposition__class">{accountKindLabel(account.kind)}</span>
                </div>
                <div className="yd-eposition__actions">
                  <button
                    type="button"
                    className="yd-editor__action"
                    disabled={restoringId === account.id}
                    onClick={() => void restoreAccount(account.id)}
                  >
                    <span className="sr-only">{`Réactiver ${account.name}`}</span>
                    <span aria-hidden="true">Réactiver</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editing?.kind === "account" && editing.account === undefined ? (
        <AccountForm onSaved={saved} onCancel={() => setEditing(null)} />
      ) : (
        <button
          type="button"
          className="yd-editor__add"
          onClick={() => setEditing({ kind: "account" })}
        >
          Ajouter un compte d'investissement
        </button>
      )}
    </div>
  );
}
