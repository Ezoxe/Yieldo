import "./ChartKey.css";

export interface ChartKeyEntry {
  key: string;
  name: string;
  color: string;
}

/**
 * The key for a chart, in HTML above the canvas. See ChartKey.css for why it is
 * not an ECharts `legend`.
 *
 * The swatch is decorative and `aria-hidden`: the name beside it is what
 * identifies the band, so colour is never the only channel carrying meaning.
 */
export function ChartKey({ entries }: { entries: ChartKeyEntry[] }) {
  return (
    <ul className="yd-chart-key">
      {entries.map((entry) => (
        <li key={entry.key} className="yd-chart-key__item">
          <span
            className="yd-chart-key__swatch"
            style={{ background: entry.color }}
            aria-hidden="true"
          />
          {entry.name}
        </li>
      ))}
    </ul>
  );
}
