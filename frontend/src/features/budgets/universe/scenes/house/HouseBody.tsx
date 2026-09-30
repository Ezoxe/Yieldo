import type { HouseIds } from "./defs";
import { ROOF_PATH } from "./geometry";

const url = (id: string) => `url(#${id})`;

/** A window with its two shutters, its mullions and its sill. */
function Window({ x, lit, glass, delay = 0 }: { x: number; lit: boolean; glass: string; delay?: number }) {
  const slats = (from: number) =>
    [193, 199, 205, 211, 217, 223, 229].map((y) => `M${from},${y} H${from + 13}`).join(" ");
  return (
    <g>
      <rect x={x - 13} y="188" width="13" height="50" className="yd-house__shutter" />
      <rect x={x + 38} y="188" width="13" height="50" className="yd-house__shutter" />
      <path d={`${slats(x - 13)} ${slats(x + 38)}`} className="yd-house__slats" />
      {lit ? (
        <rect
          x={x}
          y="188"
          width="38"
          height="50"
          className="yd-house__window"
          fill={glass}
          style={{ animationDelay: `${delay}s` }}
        />
      ) : (
        <rect x={x} y="188" width="38" height="50" className="yd-house__window-dark" />
      )}
      <path d={`M${x + 19},188 V238 M${x},205 H${x + 38} M${x},221 H${x + 38}`} className="yd-house__mullion" />
      <rect x={x - 3} y="238" width="44" height="4" className="yd-house__sill" />
    </g>
  );
}

/**
 * What stands around the house: the sky (a dusk in the dark theme, a day in
 * the light one — `HouseScene.css`), stars, moon or sun, the hills, a tree,
 * the lawn and the path, the hedges, the low wall with the meter box and the
 * gate. Decoration only.
 */
export function HouseBackdrop({ ids }: { ids: HouseIds }) {
  return (
    <g className="yd-house__backdrop">
      <rect x="0" y="0" width="640" height="264" fill={url(ids.sky)} />
      <g className="yd-house__stars">
        <circle className="yd-house__star yd-house__star--twinkle" cx="120" cy="22" r="1" />
        <circle className="yd-house__star" cx="260" cy="14" r=".8" />
        <circle className="yd-house__star yd-house__star--twinkle" cx="330" cy="30" r="1" style={{ animationDelay: "1s" }} />
        <circle className="yd-house__star" cx="455" cy="18" r=".9" />
        <circle className="yd-house__star yd-house__star--twinkle" cx="610" cy="96" r=".8" style={{ animationDelay: "2s" }} />
        <circle className="yd-house__star" cx="548" cy="70" r=".7" />
        <circle className="yd-house__star yd-house__star--twinkle" cx="88" cy="70" r=".8" style={{ animationDelay: "1.6s" }} />
        <circle className="yd-house__star" cx="20" cy="120" r=".7" />
      </g>
      <g className="yd-house__moon">
        <circle cx="596" cy="44" r="20" fill={url(ids.moonGlow)} />
        <circle cx="596" cy="44" r="11" className="yd-house__moon-disc" />
        <circle cx="600" cy="41" r="10" className="yd-house__moon-shadow" />
      </g>
      <g className="yd-house__sun">
        <circle cx="596" cy="44" r="30" fill={url(ids.sunGlow)} />
        <circle cx="596" cy="44" r="12" className="yd-house__sun-disc" />
      </g>
      <path
        d="M0,238 C60,226 110,232 160,224 C230,214 300,222 380,216 C450,211 520,222 640,212 L640,264 L0,264 Z"
        className="yd-house__hills"
      />
      <path d="M548,262 L552,196 L558,196 L562,262 Z" className="yd-house__trunk" />
      <g className="yd-house__foliage">
        <circle cx="555" cy="160" r="34" />
        <circle cx="530" cy="182" r="26" />
        <circle cx="582" cy="182" r="28" />
        <circle cx="560" cy="130" r="24" />
        <circle cx="600" cy="150" r="22" />
      </g>
      <g className="yd-house__foliage-light">
        <circle cx="545" cy="150" r="14" />
        <circle cx="572" cy="168" r="12" />
        <circle cx="530" cy="176" r="10" />
      </g>

      <rect x="0" y="262" width="640" height="100" fill={url(ids.lawn)} />
      <path d="M0,262 H640" className="yd-house__lawn-edge" />
      <path
        d="M40,300 l2,-6 M44,300 l-1,-5 M600,318 l2,-6 M604,318 l-1,-5 M170,330 l2,-6 M390,340 l-2,-6 M520,300 l1,-5"
        className="yd-house__grass"
      />
      <path d="M248,262 L284,262 L312,362 L220,362 Z" className="yd-house__path" />
      <path d="M246,280 H286 M242,300 H292 M236,322 H298 M230,344 H304 M266,262 V362" className="yd-house__path-joints" />

      <path d="M0,236 C8,226 22,226 30,234 C38,226 50,228 56,238 L56,262 L0,262 Z" className="yd-house__hedge" />
      <path d="M470,244 C480,232 494,234 500,242 L500,262 L470,262 Z" className="yd-house__hedge" />
      <rect x="498" y="232" width="142" height="30" className="yd-house__wall" />
      <path d="M498,232 H640" className="yd-house__wall-cap" />
      <rect x="500" y="236" width="18" height="22" rx="1.5" className="yd-house__coffret" />
      <path d="M509,236 V258" className="yd-house__coffret-line" />
      <path d="M556,262 V218 M566,262 V214 M576,262 V212 M586,262 V214 M596,262 V218" className="yd-house__gate-bars" />
      <path d="M552,226 H600" className="yd-house__gate-rail" />
      <rect x="548" y="206" width="6" height="56" className="yd-house__gate-post" />
      <rect x="598" y="206" width="6" height="56" className="yd-house__gate-post" />
    </g>
  );
}

/** The house itself: garage, walls, chimney, roof, dormer, windows, door, lamp. */
export function HouseBody({ ids }: { ids: HouseIds }) {
  const quoins: Array<[number, number, number, number]> = [];
  for (let row = 0; row < 10; row += 1) {
    const y = 160 + row * 9;
    const wide = row % 2 === 0;
    const h = row === 9 ? 11 : 9;
    quoins.push([150, y, wide ? 12 : 8, h], [wide ? 458 : 462, y, wide ? 12 : 8, h]);
  }
  return (
    <g className="yd-house__body">
      <path d="M50,196 L150,176 L150,184 L56,202 Z" fill={url(ids.tiles)} />
      <path d="M50,196 L150,176" className="yd-house__roof-edge yd-house__roof-edge--thin" />
      <rect x="58" y="200" width="92" height="62" fill={url(ids.render)} />
      <rect x="58" y="200" width="92" height="62" fill={url(ids.wallShade)} />
      <rect x="70" y="208" width="68" height="54" fill={url(ids.garage)} />
      <path d="M70,219 H138 M70,230 H138 M70,241 H138 M70,252 H138" className="yd-house__garage-lines" />
      <rect x="70" y="208" width="68" height="54" className="yd-house__garage-veil" />
      <rect x="100" y="246" width="8" height="2" rx="1" className="yd-house__garage-handle" />

      <rect x="150" y="150" width="320" height="112" fill={url(ids.render)} />
      <rect x="150" y="150" width="320" height="112" fill={url(ids.wallShade)} />
      <rect x="150" y="150" width="320" height="112" className="yd-house__night-veil" />
      <rect x="150" y="252" width="320" height="10" className="yd-house__plinth" />
      <g className="yd-house__quoins">
        {quoins.map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />
        ))}
      </g>

      <path d="M404,62 H424 V104 H404 Z" fill={url(ids.brick)} />
      <rect x="400" y="56" width="28" height="7" rx="1" className="yd-house__chimney-cap" />
      {[0, 1.7, 3.4].map((delay) => (
        <circle key={delay} className="yd-house__smoke" cx="414" cy="52" r="5" style={{ animationDelay: `${delay}s` }} />
      ))}

      <path d={ROOF_PATH} fill={url(ids.tiles)} />
      <path d={ROOF_PATH} fill={url(ids.roofShade)} />
      <path d="M134,156 L232,74 M388,74 L486,156 M232,74 H388" className="yd-house__roof-edge" />
      <rect x="132" y="155" width="356" height="5" rx="1.5" className="yd-house__zinc" />
      <path d="M476,160 V262" className="yd-house__downspout" />

      <path d="M286,112 L310,90 L334,112 Z" fill={url(ids.tiles)} />
      <path d="M284,113 L310,89 L336,113" className="yd-house__roof-edge yd-house__roof-edge--dormer" />
      <rect x="292" y="112" width="36" height="34" fill={url(ids.render)} />
      <rect x="298" y="117" width="24" height="26" className="yd-house__window" fill={url(ids.glass)} />
      <path d="M310,117 V143 M298,130 H322" className="yd-house__mullion" />
      <rect x="296" y="143" width="28" height="3" className="yd-house__sill" />

      <Window x={182} lit glass={url(ids.glass)} />
      <Window x={330} lit glass={url(ids.glass)} delay={1.3} />
      <Window x={400} lit={false} glass={url(ids.glass)} />

      <rect x="246" y="198" width="30" height="64" fill={url(ids.door)} />
      <rect x="250" y="202" width="22" height="12" rx="1" className="yd-house__transom" fill={url(ids.glass)} />
      <rect x="250" y="219" width="22" height="16" className="yd-house__door-panel" />
      <rect x="250" y="240" width="22" height="18" className="yd-house__door-panel" />
      <circle cx="270" cy="236" r="1.6" className="yd-house__knob" />
      <path d="M238,194 Q261,186 284,194" className="yd-house__canopy" />
      <path d="M238,194 Q261,188 284,194 L284,197 Q261,191 238,197 Z" className="yd-house__canopy-glass" />
      <circle cx="292" cy="214" r="26" fill={url(ids.lamp)} className="yd-house__lamp-glow" />
      <rect x="289" y="207" width="6" height="9" rx="1.5" className="yd-house__lamp-body" />
      <rect x="290" y="209" width="4" height="5" className="yd-house__lamp-bulb" />
      <rect x="242" y="262" width="38" height="4" className="yd-house__step" />
    </g>
  );
}
