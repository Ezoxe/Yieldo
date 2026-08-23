import { useId, useState } from "react";

import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { PriceIndexPoint } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** "2025-01;118,42", with a semicolon, comma or tab between the two halves —
 *  whichever a spreadsheet or a copied table happens to put there. */
const LINE = /^(\d{4})-(\d{2})\s*[;,\t]\s*(-?\d+(?:[.,]\d+)?)$/;

/**
 * `PriceIndexPointIn.value` is `Decimal = Field(gt=0, le=1_000_000)`. Repeated
 * here to keep the refusal in French: Pydantic's own rejection travels as a
 * schema-validation detail list whose `msg` is English ("Input should be
 * greater than 0"), and `lib/api.ts` would surface that verbatim.
 */
const MAX_INDEX_VALUE = 1_000_000;

export interface ParsedSeries {
  points: { month: string; value: string }[];
  errors: string[];
}

/**
 * A decimal string to hundredths, exactly — the same integer the backend
 * stores as `value_hundredths`.
 *
 * String arithmetic, never `Number(text) * 100`: this figure is compared
 * against a zero boundary that a float can land on the wrong side of, and the
 * repository's own `parseCents` refuses the same shortcut for the same reason.
 * Half-up on the third decimal, matching `ROUND_HALF_UP` in the router.
 */
function toHundredths(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const padded = fraction.padEnd(3, "0");
  const hundredths = Number(whole) * 100 + Number(padded.slice(0, 2));
  return Number(padded[2]) >= 5 ? hundredths + 1 : hundredths;
}

function lineError(index: number, line: string, expectation: string): string {
  return `Ligne ${index + 1} — « ${line} » : ${expectation}`;
}

/**
 * "2025-01;118,42" per line, into what the API expects.
 *
 * The value is kept as a decimal STRING and handed to the backend as one,
 * where Pydantic parses it into a `Decimal`. Turning it into a JavaScript
 * number here would round-trip an exact index level through a float for no
 * reason.
 *
 * Every line that cannot be read is named, and NOTHING is sent when any line
 * fails: a parser that skipped the bad ones would silently store a shorter
 * series than the reader pasted, and PUT replaces the whole series, so the
 * dropped months would be gone rather than merely unread.
 *
 * The three value guards mirror the backend's own — `gt=0`, `le=1_000_000`,
 * and the router's post-rounding "still positive at the hundredth" check —
 * so that every refusal the reader can provoke is phrased in French and names
 * the line that caused it. They are duplicated deliberately, not trusted to:
 * the backend still enforces all three.
 */
export function parseIndexSeries(text: string): ParsedSeries {
  const points: { month: string; value: string }[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;

    const match = LINE.exec(line);
    if (match === null) {
      errors.push(lineError(index, line, "format attendu AAAA-MM;118,42"));
      return;
    }

    const [, year, month, rawValue] = match;
    if (Number(month) < 1 || Number(month) > 12) {
      errors.push(lineError(index, line, "le mois doit aller de 01 à 12"));
      return;
    }
    const key = `${year}-${month}`;

    const previous = seen.get(key);
    if (previous !== undefined) {
      errors.push(
        lineError(
          index,
          line,
          `le mois ${key} est déjà donné à la ligne ${previous + 1}. Un mois ne peut figurer qu'une fois.`,
        ),
      );
      return;
    }

    const value = rawValue.replace(",", ".");
    if (value.startsWith("-")) {
      errors.push(lineError(index, line, "la valeur d'un indice est strictement positive"));
      return;
    }
    if (toHundredths(value) <= 0) {
      errors.push(
        lineError(
          index,
          line,
          "une fois arrondie au centième, la valeur doit rester strictement positive",
        ),
      );
      return;
    }
    if (Number(value) > MAX_INDEX_VALUE) {
      errors.push(lineError(index, line, "la valeur doit rester au plus à 1 000 000"));
      return;
    }

    seen.set(key, index);
    points.push({ month: key, value });
  });

  // All or nothing: a series stored half-read is a series the reader believes
  // they pasted in full.
  return errors.length > 0 ? { points: [], errors } : { points, errors };
}

interface PriceIndexFormProps {
  points: PriceIndexPoint[];
  onSaved: () => void;
}

export function PriceIndexForm({ points, onSaved }: PriceIndexFormProps) {
  const [text, setText] = useState("");
  // A list, not a joined sentence: a ten-line paste can fail on four of them,
  // and four refusals run together read as one long paragraph in which no
  // individual line number stands out — which is the only thing the reader
  // needs from it.
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hasError = errors.length > 0;

  async function save() {
    const parsed = parseIndexSeries(text);
    if (parsed.errors.length > 0) {
      setErrors(parsed.errors);
      return;
    }
    if (parsed.points.length === 0) {
      // PUT replaces the whole series, so an empty payload erases what is
      // stored. An empty textarea is far more often an accidental click than a
      // decision, so saving never means erasing: clearing has its own button.
      setErrors([
        points.length === 0
          ? "Aucune ligne à enregistrer. Collez une série, une ligne par mois."
          : "Aucune ligne à enregistrer. Collez une série, une ligne par mois — ou utilisez « Effacer l'indice » pour supprimer celle qui est enregistrée.",
      ]);
      return;
    }
    await send(parsed.points);
  }

  async function send(next: { month: string; value: string }[]) {
    setSaving(true);
    try {
      await api.put("/analysis/price-index", { points: next });
      setErrors([]);
      setText("");
      onSaved();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.detail : GENERIC_ERROR]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="yd-index">
      {points.length === 0 ? (
        <p className="yd-index__state">
          Aucun indice de référence n'est enregistré. La comparaison avec une source extérieure
          reste vide — aucun zéro n'est affiché à sa place.
        </p>
      ) : (
        <p className="yd-index__state">
          {`${points.length} ${plural(points.length, "mois enregistré", "mois enregistrés")}, de ${points[0].month} à ${points[points.length - 1].month}.`}
        </p>
      )}

      <p className="yd-index__note">
        Yieldo ne se connecte à aucun service : aucune donnée n'est téléchargée. Copiez vous-même
        la série de votre choix — l'indice des prix à la consommation de l'INSEE, par exemple —
        une ligne par mois, au format
        <code> AAAA-MM;118,42</code>. Enregistrer remplace la série précédente.
      </p>

      {/* A grid rather than a flex column: the textarea's `width: 100%` needs a
          definite track to resolve against, and `minmax(0, 1fr)` is what stops
          the placeholder's own longest line setting the column's width. */}
      <div className="yd-index__field">
        <label htmlFor={fieldId}>Série de l'indice</label>
        <textarea
          id={fieldId}
          rows={5}
          value={text}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            // What was pasted is what was rejected; once it changes, the
            // message no longer describes the field it sits under.
            if (hasError) setErrors([]);
          }}
          placeholder={"2025-01;118,42\n2025-02;118,90"}
        />
      </div>

      {hasError ? (
        <div id={errorId} role="alert" className="yd-index__error">
          {errors.length === 1 ? (
            <p>{errors[0]}</p>
          ) : (
            <ul>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="yd-index__actions">
        <button
          type="button"
          className="yd-index__save"
          disabled={saving}
          onClick={() => void save()}
        >
          Enregistrer l'indice
        </button>
        {points.length > 0 ? (
          <button
            type="button"
            className="yd-index__clear"
            disabled={saving}
            onClick={() => void send([])}
          >
            Effacer l'indice
          </button>
        ) : null}
      </div>
    </div>
  );
}
