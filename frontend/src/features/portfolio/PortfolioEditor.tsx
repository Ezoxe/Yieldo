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
 * positions the envelope holds keep being valued and keep counting toward the
 * total. Promising that they disappear would be this project's most repeated
 * defect — a French sentence naming a consequence nobody incurs.
 */
function archiveQuestion(name: string, positionCount: number): string {
  if (positionCount === 0) {
    return `Archiver « ${name} » ? Le compte quitte cette liste ; il ne détient aucune position. Archiver n'efface rien.`;
  }
  if (positionCount === 1) {
    return `Archiver « ${name} » ? Le compte quitte cette liste, mais la position qu'il détient reste déclarée et continue d'être valorisée : archiver n'efface rien.`;
  }
  return `Archiver « ${name} » ? Le compte quitte cette liste, mais les ${positionCount} positions qu'il détient restent déclarées et continuent d'être valorisées : archiver n'efface rien.`;
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
  /** The positions as the valuation returns them — one place the symbol, the
   *  name and the asset class are already resolved, so this panel and the
   *  holdings table above it can never disagree about what a position is. */
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
 * archiving an account keeps everything, deleting a position takes its lots
 * with it at the database level, deleting a lot changes the position's
 * quantity. A refusal from the API is shown where the action was, never
 * swallowed into a silent no-op.
 */
export function PortfolioEditor({ accounts, positions, lots, onChanged }: PortfolioEditorProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

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
                  // API sets `archived` and nothing else, and the valuation
                  // keeps counting the positions the envelope holds. Written
                  // out per count rather than through a plural helper, because
                  // French changes more than one word between the three.
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

  // Positions whose envelope is not in the list: their account was archived.
  // They are still valued in the total above, so they stay editable here
  // rather than becoming unreachable rows nobody can correct.
  const knownAccounts = new Set(accounts.map((account) => account.id));
  const orphans = positions.filter((position) => !knownAccounts.has(position.account_id));

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

      {orphans.length > 0 ? (
        <section className="yd-eaccount" data-testid="yd-editor-archived">
          <div className="yd-eaccount__head">
            <h3 className="yd-eaccount__name">Positions d'un compte archivé</h3>
            <p className="yd-eaccount__meta">
              Leur enveloppe a été archivée. Elles restent valorisées dans le total ci-dessus —
              archiver un compte n'efface pas ce qu'il détient.
            </p>
          </div>
          <ul className="yd-epositions">{orphans.map(renderPosition)}</ul>
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
