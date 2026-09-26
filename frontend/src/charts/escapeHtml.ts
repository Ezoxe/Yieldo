/**
 * Text, made safe to put inside HTML.
 *
 * ECharts renders a tooltip formatter's return value with `innerHTML`. Every
 * string that comes from the household's data -- a category, a label, a debt,
 * a symbol, a model's message -- goes through this before it is interpolated,
 * or a category named `<img onerror=…>` runs in the owner's session. Figures
 * formatted by `formatCents` and dates formatted by `frenchDate` are the
 * application's own output and need not pass through it.
 */
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
