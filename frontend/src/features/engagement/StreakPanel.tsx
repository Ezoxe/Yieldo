import type { MonthCovered, Streak } from "../../lib/types";
import { plural } from "../../lib/plural";

/**
 * "2026-01" → "janvier 2026".
 *
 * A local copy: `features/budgets/BudgetsPage.tsx` exports the same six lines,
 * but importing it would pull that whole screen — and its stylesheet — into
 * this bundle for a date format. If a third screen needs it, it moves to
 * `design/EmptyState.tsx` beside `frenchDate`.
 */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * THREE states, never two.
 *
 * * `covered` — the month holds operations;
 * * `empty` — a statement's own span reaches this month and it held nothing;
 * * `missing` — no statement has ever touched it.
 *
 * `engines/streak.py` counts the first two toward the streak and breaks only
 * on the third, which is exactly why the operator's longest run is 13 months
 * and not 3: eight of his months are `empty`, not `missing`. Collapsing the
 * two into one "not covered" swatch would make his own record look like a bug.
 */
export type MonthState = "covered" | "empty" | "missing";

export function monthState(month: MonthCovered): MonthState {
  if (month.covered) return "covered";
  return month.imported ? "empty" : "missing";
}

/** What a screen reader hears on a cell — the state in words, so colour is
 *  never the only channel carrying it. */
function monthSentence(month: MonthCovered): string {
  const label = monthLabel(month.key);
  switch (monthState(month)) {
    case "covered":
      return (
        `${label} : ${month.transaction_count} ` +
        `${plural(month.transaction_count, "opération importée", "opérations importées")}.`
      );
    case "empty":
      return `${label} : relevé importé, aucune opération ce mois-là.`;
    case "missing":
      return `${label} : aucun relevé importé.`;
  }
}

const KEY_ENTRIES: { state: MonthState; name: string }[] = [
  { state: "covered", name: "Relevé importé, avec opérations" },
  { state: "empty", name: "Relevé importé, aucune opération" },
  { state: "missing", name: "Aucun relevé" },
];

/** The months, split into one group per calendar year, in the order the engine
 *  produced them (ascending, contiguous). */
function byYear(months: MonthCovered[]): { year: string; months: MonthCovered[] }[] {
  const groups: { year: string; months: MonthCovered[] }[] = [];
  for (const month of months) {
    const year = month.key.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.year === year) last.months.push(month);
    else groups.push({ year, months: [month] });
  }
  return groups;
}

/** The month's own two-digit number, which is what the cell shows. */
function monthNumber(key: string): string {
  return key.slice(5, 7);
}

/**
 * How many consecutive months of statements the household has actually
 * imported — design §6.2's "mesure une habitude réelle, pas un score
 * artificiel".
 *
 * Nothing here is a badge, a level or a trophy. The count is a measurement,
 * the record beside it is a measurement, and the strip is the evidence both
 * were read off.
 */
export function StreakPanel({ streak }: { streak: Streak }) {
  const groups = byYear(streak.months);

  return (
    <div className="yd-streak">
      <div className="yd-streak__figure">
        <p
          className={`yd-streak__count${streak.current > 0 ? " yd-streak__count--live" : " yd-streak__count--broken"}`}
          data-testid="yd-streak-current"
        >
          {streak.current}
        </p>
        <p className="yd-streak__unit">
          {`${plural(streak.current, "mois consécutif", "mois consécutifs")} de relevés importés`}
        </p>
      </div>

      <div className="yd-streak__detail">
        {/* The engine's sentence, verbatim. It names WHICH of two causes
            applies — the follow-up stopped, or it never began — and the two
            remedies are not the same. */}
        {streak.broken_reason !== null ? (
          <p className="yd-suivi__refusal" data-testid="yd-streak-refusal">
            {streak.broken_reason}
          </p>
        ) : null}

        {streak.longest > 0 ? (
          <p className="yd-suivi__note">
            {`Votre plus longue série : ${streak.longest} ${plural(streak.longest, "mois", "mois")}.`}
            {streak.last_complete_month !== null
              ? ` Dernier mois importé : ${monthLabel(streak.last_complete_month)}.`
              : ""}
          </p>
        ) : null}

        {groups.length > 0 ? (
          <>
            <ul className="yd-suivi__key">
              {KEY_ENTRIES.map((entry) => (
                <li key={entry.state} className="yd-suivi__key-item">
                  <span
                    className={`yd-streak__swatch yd-streak__swatch--${entry.state}`}
                    aria-hidden="true"
                  />
                  {entry.name}
                </li>
              ))}
            </ul>

            <div className="yd-streak__strip" data-testid="yd-streak-strip">
              {groups.map((group) => (
                <div key={group.year} className="yd-streak__year">
                  {/* The year is repeated inside every cell's own sentence
                      below, so this caption is decoration for the eye alone. */}
                  <p className="yd-streak__year-label" aria-hidden="true">
                    {group.year}
                  </p>
                  <ol className="yd-streak__months">
                    {group.months.map((month) => (
                      <li
                        key={month.key}
                        className={`yd-streak__month yd-streak__month--${monthState(month)}`}
                        data-testid={`yd-streak-month-${month.key}`}
                      >
                        <span className="yd-streak__month-num" aria-hidden="true">
                          {monthNumber(month.key)}
                        </span>
                        <span className="sr-only">{monthSentence(month)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>

            <p className="yd-suivi__note">
              Le mois en cours ne compte ni pour ni contre : il n'est pas terminé. Un import fait
              aujourd'hui rallonge la série le jour même.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
