import type { BankIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/** The cash machine's keypad: three columns, four rows, a zero below. */
const KEYS = [
  ...[176, 185, 194].flatMap((y) => [60, 72, 84].map((x) => ({ x, y }))),
  { x: 72, y: 203 },
];

/** The vault door's bolts, every 45° around its rim. */
const BOLTS = Array.from({ length: 8 }, (_, index) => {
  const angle = (index * Math.PI) / 4;
  return { x: Number((540 + 64 * Math.sin(angle)).toFixed(2)), y: Number((160 - 64 * Math.cos(angle)).toFixed(2)) };
});

/**
 * The lobby after hours: a slate wall over a veined marble wainscot, a
 * chequered marble floor; the cash machine lit in its recess, its screen,
 * keypad and slots; the counter behind its glass partition, the speaking
 * grilles, the tray with a statement on it, the leaflets, the chained pen and
 * the bell; the queue posts and their strap; the clock; the round vault door,
 * its bolts and its wheel; a plant. The light is the cash machine's and the
 * counter's at dusk in the dark theme, the day's in the light one —
 * `BankScene.css`. Decoration only.
 */
export function BankBody({ ids }: { ids: BankIds }) {
  return (
    <g className="yd-bank__room">
      <rect x="0" y="0" width="640" height="262" fill={url(ids.wall)} />
      <rect x="0" y="196" width="640" height="58" className="yd-bank__marble" />
      <path d="M0,196 H640" className="yd-bank__rail" />
      <path d="M20,210 Q60,230 110,214 M170,236 Q230,222 280,240 M470,226 Q520,214 600,232" className="yd-bank__veins" />
      <rect x="0" y="252" width="640" height="10" className="yd-bank__plinth" />
      <rect x="0" y="262" width="640" height="100" fill={url(ids.floor)} />
      <rect x="0" y="262" width="640" height="100" className="yd-bank__floor-shade" />
      <ellipse cx="90" cy="268" rx="90" ry="16" fill={url(ids.cool)} className="yd-bank__glow" />
      <ellipse cx="310" cy="96" rx="140" ry="60" fill={url(ids.warm)} className="yd-bank__glow" />

      <rect x="30" y="112" width="120" height="144" className="yd-bank__recess" />
      <rect x="34" y="112" width="112" height="4" className="yd-bank__canopy" />
      <ellipse cx="90" cy="140" rx="60" ry="30" fill={url(ids.cool)} className="yd-bank__glow" />
      <rect x="40" y="118" width="100" height="132" rx="3" fill={url(ids.fascia)} />
      <rect x="56" y="128" width="68" height="32" rx="2" className="yd-bank__screen-frame" />
      <rect x="60" y="132" width="60" height="24" className="yd-bank__screen" />
      <path d="M66,140 H100 M66,146 H92 M66,152 H96" className="yd-bank__screen-menu" />
      <g className="yd-bank__keys">
        {KEYS.map((key) => (
          <rect key={`${key.x}-${key.y}`} x={key.x} y={key.y} width="9" height="6" rx="1" />
        ))}
      </g>
      <rect x="104" y="180" width="24" height="6" rx="2" className="yd-bank__slot" />
      <circle cx="130" cy="183" r="1.6" className="yd-bank__led" />
      <rect x="104" y="196" width="20" height="4" rx="1" className="yd-bank__slot" />
      <rect x="58" y="222" width="64" height="8" rx="2" className="yd-bank__slot" />

      <rect x="196" y="84" width="228" height="98" className="yd-bank__office" />
      <rect x="200" y="88" width="220" height="92" className="yd-bank__glass" />
      <path d="M273,88 V180 M347,88 V180" className="yd-bank__glass-frame" />
      <rect x="200" y="88" width="220" height="92" className="yd-bank__glass-frame" />
      <path d="M210,98 L236,124 M284,98 L300,114 M358,98 L382,122" className="yd-bank__reflection" />
      {[236, 310, 384].map((x) => (
        <g key={x}>
          <circle cx={x} cy="140" r="6" className="yd-bank__grille" />
          <circle cx={x - 2} cy="139" r=".8" className="yd-bank__grille-hole" />
          <circle cx={x + 2} cy="139" r=".8" className="yd-bank__grille-hole" />
          <circle cx={x} cy="142" r=".8" className="yd-bank__grille-hole" />
        </g>
      ))}
      <rect x="192" y="180" width="236" height="8" className="yd-bank__counter-top" />
      <rect x="196" y="188" width="228" height="60" className="yd-bank__counter" />
      <g className="yd-bank__counter-panels">
        <rect x="206" y="196" width="62" height="44" />
        <rect x="279" y="196" width="62" height="44" />
        <rect x="352" y="196" width="62" height="44" />
      </g>
      <rect x="196" y="248" width="228" height="8" className="yd-bank__kick-plate" />
      <path d="M286,180 L290,174 H330 L334,180 Z" className="yd-bank__tray" />
      <rect x="294" y="172" width="24" height="7" className="yd-bank__paper" />
      <rect x="220" y="160" width="30" height="20" className="yd-bank__leaflet-stand" />
      <rect x="223" y="156" width="7" height="12" className="yd-bank__leaflet yd-bank__leaflet--blue" />
      <rect x="231" y="158" width="7" height="12" className="yd-bank__leaflet yd-bank__leaflet--red" />
      <rect x="239" y="157" width="7" height="12" className="yd-bank__leaflet yd-bank__leaflet--yellow" />
      <path d="M346,178 L362,174" className="yd-bank__pen" />
      <path d="M362,174 Q372,170 380,178" className="yd-bank__chain" />
      <path d="M392,180 Q392,172 400,172 Q408,172 408,180 Z" className="yd-bank__bell" />
      <rect x="398" y="168" width="4" height="4" rx="1" className="yd-bank__bell" />

      <circle cx="560" cy="44" r="13" className="yd-bank__clock" />
      <path d="M560,44 V36" className="yd-bank__clock-hand" />
      <path d="M560,44 L566,48" className="yd-bank__clock-hand yd-bank__clock-hand--minutes" />
      <rect x="466" y="70" width="148" height="182" className="yd-bank__vault-wall" />
      <rect x="462" y="108" width="10" height="24" rx="2" className="yd-bank__hinge" />
      <rect x="462" y="188" width="10" height="24" rx="2" className="yd-bank__hinge" />
      <circle cx="540" cy="160" r="70" fill={url(ids.steel)} />
      <circle cx="540" cy="160" r="60" className="yd-bank__vault-ring" />
      <g className="yd-bank__bolts">
        {BOLTS.map((bolt) => (
          <circle key={`${bolt.x}-${bolt.y}`} cx={bolt.x} cy={bolt.y} r="3" />
        ))}
      </g>
      <circle cx="540" cy="160" r="18" className="yd-bank__wheel" />
      <path d="M540,142 V132 M540,178 V188 M522,160 H512 M558,160 H568 M527,147 L520,140 M553,173 L560,180" className="yd-bank__spokes" />
      <circle cx="540" cy="160" r="5" className="yd-bank__hub" />
      <rect x="466" y="70" width="148" height="182" className="yd-bank__vault-shade" />
      <path d="M436,256 H456 L452,236 H440 Z" className="yd-bank__pot" />
      <path
        d="M446,236 C438,224 436,210 440,198 C446,210 448,224 446,236 Z M446,236 C450,222 456,212 462,208 C462,222 456,232 446,236 Z"
        className="yd-bank__leaves"
      />

      <g className="yd-bank__posts">
        <rect x="168" y="214" width="4" height="44" />
        <rect x="298" y="214" width="4" height="44" />
        <rect x="438" y="214" width="4" height="44" />
      </g>
      <g className="yd-bank__post-bases">
        <ellipse cx="170" cy="258" rx="9" ry="2.5" />
        <ellipse cx="300" cy="258" rx="9" ry="2.5" />
        <ellipse cx="440" cy="258" rx="9" ry="2.5" />
      </g>
      <path d="M172,220 Q235,230 298,220 M302,220 Q370,230 438,220" className="yd-bank__strap" />
      <g className="yd-bank__floor-shadows">
        <ellipse cx="310" cy="259" rx="120" ry="3" />
        <ellipse cx="540" cy="258" rx="80" ry="3" />
      </g>
    </g>
  );
}
