import { formatCents } from "../../design/theme";
import type { Occurrence, OccurrenceStatus } from "../../lib/types";

/**
 * A month, drawn as the calendar it is, with each due date on its own day.
 *
 * Not a list sorted by date: a household reads a month of direct debits the way
 * it reads a wall calendar -- "what lands next week", "did the 15th go through"
 * -- and a flat list answers neither question without counting. The grid is the
 * point.
 *
 * Every cell is a real `<td>` inside a real `<table>` with `<th scope="col">`
 * weekday headings, so the structure a sighted reader gets from the shape is
 * the structure a screen reader is told.
 */

/** Monday-first, the way a French calendar is read. */
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  pointed: "Pointée",
  late: "En retard",
  due: "À échéance",
  upcoming: "À venir",
};

/** `YYYY-MM-DD` from a Date, without going through a timezone. */
export function isoDay(year: number, month: number, day: number): string {
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
}

/**
 * The Monday-based column a date falls in, 0..6.
 *
 * `Date.getDay()` is Sunday-based (0 = Sunday), and using it verbatim would
 * put every Sunday in the first column of a French calendar.
 */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** The weeks of a month, each a row of seven days or nulls for the padding. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;

  const cells: (number | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

interface RecurrenceCalendarProps {
  year: number;
  /** 1-based, the way a person says it. */
  month: number;
  occurrences: Occurrence[];
  /** Ticking one off, or un-ticking one already pointed. */
  onToggle: (occurrence: Occurrence) => void;
  /** An id whose write is in flight, so its control can say so. */
  pending: string | null;
}

/** The key that identifies one occurrence: a declaration and a due date. */
export function occurrenceKey(occurrence: Occurrence): string {
  return `${occurrence.schedule_id}:${occurrence.due_on}`;
}

export function RecurrenceCalendar({
  year,
  month,
  occurrences,
  onToggle,
  pending,
}: RecurrenceCalendarProps) {
  const byDay = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const list = byDay.get(occurrence.due_on) ?? [];
    list.push(occurrence);
    byDay.set(occurrence.due_on, list);
  }

  return (
    <table className="yd-rcal">
      <thead>
        <tr>
          {WEEKDAYS.map((day) => (
            <th key={day} scope="col" className="yd-rcal__weekday">
              {day}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthGrid(year, month).map((week, index) => (
          <tr key={index}>
            {week.map((day, position) => {
              if (day === null) {
                return <td key={position} className="yd-rcal__pad" aria-hidden="true" />;
              }
              const iso = isoDay(year, month, day);
              const here = byDay.get(iso) ?? [];
              return (
                <td key={position} className="yd-rcal__day">
                  <span className="yd-rcal__number yd-num">{day}</span>
                  {here.map((occurrence) => {
                    const key = occurrenceKey(occurrence);
                    const busy = pending === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`yd-rcal__event yd-rcal__event--${occurrence.status}`}
                        aria-pressed={occurrence.status === "pointed"}
                        disabled={busy}
                        // The whole sentence, because on a calendar the button's
                        // own text is three words in a 90px box and the reader
                        // who needs the rest is the one who cannot see the grid.
                        aria-label={
                          `${occurrence.label}, ${formatCents(occurrence.amount_cents)}, ` +
                          `échéance du ${day}. ${STATUS_LABEL[occurrence.status]}. ` +
                          (occurrence.status === "pointed"
                            ? "Cliquez pour dépointer."
                            : "Cliquez pour pointer.")
                        }
                        onClick={() => onToggle(occurrence)}
                      >
                        <span className="yd-rcal__event-label">{occurrence.label}</span>
                        <span className="yd-rcal__event-amount yd-num">
                          {formatCents(occurrence.amount_cents)}
                        </span>
                      </button>
                    );
                  })}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
