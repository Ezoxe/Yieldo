/**
 * The form that agrees with `count`, in French.
 *
 * French takes the singular for zero as well as for one -- "0 ligne importée",
 * not "0 lignes importées" -- so the switch is on `count > 1`, never on
 * `count !== 1`.
 *
 * It takes both written-out forms rather than a stem and a suffix on purpose.
 * What varies between them is not reliably the last letter ("elle sera
 * supprimée" / "elles seront supprimées"), and a helper that appends an "s" to
 * the phrase it is handed writes "320 ligne importées" -- which is what three
 * of the four copies of this function used to do, on the last screen of the
 * only path that writes user data.
 */
export function plural(count: number, singular: string, pluralForm: string): string {
  return count > 1 ? pluralForm : singular;
}
