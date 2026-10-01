import type { StudyIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/** A row of binders on a shelf: one spine per colour, a label on each. */
const BINDERS: ReadonlyArray<{ x: number; y: number; tone: string; box?: boolean }> = [
  { x: 28, y: 130, tone: "teal" }, { x: 41, y: 130, tone: "red" }, { x: 54, y: 130, tone: "mustard" },
  { x: 67, y: 130, tone: "navy" }, { x: 88, y: 140, tone: "box", box: true }, { x: 126, y: 130, tone: "green" },
  { x: 139, y: 130, tone: "plum" },
  { x: 28, y: 172, tone: "navy" }, { x: 41, y: 172, tone: "navy" }, { x: 54, y: 172, tone: "teal" },
  { x: 70, y: 182, tone: "box", box: true }, { x: 110, y: 172, tone: "red" }, { x: 123, y: 172, tone: "mustard" },
  { x: 136, y: 172, tone: "green" },
  { x: 28, y: 214, tone: "box", box: true }, { x: 66, y: 214, tone: "plum" }, { x: 79, y: 214, tone: "teal" },
  { x: 92, y: 214, tone: "red" }, { x: 110, y: 224, tone: "box", box: true },
];

/**
 * The study: a navy wall over a wooden wainscot, a dark parquet and a red
 * rug; the bookcase of binders and archive boxes; the window (dusk in the
 * dark theme, day in the light one — `StudyScene.css`) with a plant on its
 * sill; the framed cadastral plan; the bureau, its pigeonholes full of
 * papers, its drop-front flap with the banker's lamp, the hourglass, the tax
 * notice and its pen, the adding machine; the filing cabinet with its letter
 * tray; the wastepaper basket. Decoration only.
 */
export function StudyBody({ ids }: { ids: StudyIds }) {
  return (
    <g className="yd-study__room">
      <rect x="0" y="0" width="640" height="262" fill={url(ids.wall)} />
      <rect x="0" y="186" width="640" height="68" className="yd-study__wainscot" />
      <path d="M0,186 H640" className="yd-study__dado" />
      <g className="yd-study__panels">
        <rect x="8" y="196" width="140" height="48" />
        <rect x="348" y="196" width="104" height="48" />
        <rect x="546" y="196" width="88" height="48" />
      </g>
      <rect x="0" y="252" width="640" height="10" className="yd-study__plinth" />
      <rect x="0" y="262" width="640" height="100" fill={url(ids.floor)} />
      <rect x="0" y="262" width="640" height="100" className="yd-study__floor-shade" />
      <rect x="150" y="270" width="210" height="30" className="yd-study__rug" />
      <rect x="156" y="274" width="198" height="22" className="yd-study__rug-border" />

      <rect x="18" y="118" width="150" height="138" className="yd-study__case" />
      <rect x="24" y="124" width="138" height="128" className="yd-study__case-inside" />
      <path d="M24,162 H162 M24,204 H162 M24,246 H162" className="yd-study__shelves" />
      {BINDERS.map((binder) =>
        binder.box ? (
          <rect key={`${binder.x}-${binder.y}`} x={binder.x} y={binder.y} width="34" height="20" className="yd-study__archive-box" />
        ) : (
          <g key={`${binder.x}-${binder.y}`}>
            <rect x={binder.x} y={binder.y} width="12" height="30" className={`yd-study__binder yd-study__binder--${binder.tone}`} />
            <rect x={binder.x + 2} y={binder.y + 6} width="8" height="5" className="yd-study__binder-label" />
          </g>
        ),
      )}
      <rect x="18" y="118" width="150" height="138" className="yd-study__case-shade" />

      <rect x="556" y="52" width="72" height="124" fill={url(ids.window)} />
      <g className="yd-study__stars">
        <circle cx="570" cy="70" r=".8" />
        <circle cx="604" cy="64" r=".7" />
        <circle cx="590" cy="96" r=".8" />
      </g>
      <circle cx="612" cy="82" r="6" className="yd-study__moon" />
      <path d="M592,52 V176 M556,112 H628" className="yd-study__mullion" />
      <rect x="552" y="48" width="80" height="132" rx="2" className="yd-study__window-frame" />
      <rect x="548" y="178" width="88" height="6" rx="1" className="yd-study__sill" />
      <path d="M602,178 H620 L617,166 H605 Z" className="yd-study__pot" />
      <path
        d="M611,166 C604,156 606,146 611,140 C616,146 618,156 611,166 Z M611,166 C618,158 624,154 628,154 C626,162 620,166 611,166 Z"
        className="yd-study__leaves"
      />

      <rect x="352" y="62" width="92" height="76" className="yd-study__plan-frame" />
      <rect x="356" y="66" width="84" height="68" className="yd-study__plan" />
      <path
        d="M356,88 L386,82 L404,96 L440,90 M386,82 L382,134 M404,96 L410,134 M356,112 L382,108 M410,112 L440,116 M420,66 L414,93"
        className="yd-study__plan-lines"
      />
      <path d="M386,82 L404,96 L410,112 L384,114 Z" className="yd-study__plan-parcel" />
      <path d="M392,104 L396,99 L400,104 V109 H392 Z" className="yd-study__plan-ink" />
      <path d="M430,72 V82 M425,77 H435" className="yd-study__plan-ink" />
      <rect x="352" y="62" width="92" height="76" className="yd-study__plan-shade" />

      <rect x="176" y="90" width="164" height="8" className="yd-study__cornice" />
      <rect x="182" y="98" width="152" height="80" className="yd-study__bureau" />
      <rect x="192" y="104" width="132" height="70" className="yd-study__pigeonholes" />
      <path d="M218,104 V174 M244,104 V174 M270,104 V174 M296,104 V174 M192,128 H324 M192,152 H324" className="yd-study__dividers" />
      <g className="yd-study__papers">
        <rect x="196" y="112" width="18" height="14" />
        <rect x="223" y="116" width="16" height="10" />
        <rect x="249" y="110" width="17" height="16" />
        <rect x="274" y="118" width="18" height="8" />
        <rect x="300" y="113" width="20" height="13" />
        <rect x="196" y="138" width="16" height="12" />
        <rect x="249" y="136" width="18" height="14" />
        <rect x="300" y="140" width="18" height="10" />
        <rect x="223" y="160" width="17" height="12" />
        <rect x="274" y="162" width="18" height="10" />
      </g>
      <g className="yd-study__folders">
        <rect x="226" y="134" width="14" height="16" />
        <rect x="276" y="138" width="16" height="12" />
        <rect x="198" y="162" width="16" height="10" />
        <rect x="302" y="160" width="16" height="12" />
      </g>
      <path d="M184,176 H332 L338,188 H178 Z" className="yd-study__flap" />
      <path d="M192,178 H324 L328,186 H188 Z" className="yd-study__leather" />
      <rect x="182" y="188" width="152" height="64" className="yd-study__bureau" />
      <path d="M186,210 H330 M186,232 H330" className="yd-study__drawer-lines" />
      <path d="M250,199 H266 M250,221 H266 M250,243 H266" className="yd-study__handles" />
      <path d="M184,252 H192 V258 H184 Z M324,252 H332 V258 H324 Z" className="yd-study__feet" />
      <rect x="176" y="90" width="164" height="168" className="yd-study__bureau-shade" />

      <ellipse cx="210" cy="182" rx="40" ry="10" fill={url(ids.warm)} className="yd-study__glow" />
      <rect x="196" y="180" width="26" height="4" rx="1" className="yd-study__brass" />
      <rect x="208" y="160" width="2" height="20" className="yd-study__brass" />
      <path d="M194,160 Q209,148 224,160 Z" className="yd-study__lamp-shade" />
      <path d="M195,160 H223" className="yd-study__bulb" />
      <path d="M219,160 V168" className="yd-study__pull-chain" />
      <rect x="236" y="154" width="20" height="3" className="yd-study__hourglass-wood" />
      <rect x="236" y="183" width="20" height="3" className="yd-study__hourglass-wood" />
      <path d="M238,157 V183 M254,157 V183" className="yd-study__hourglass-posts" />
      <path
        d="M240,157 C240,166 246,168 246,170 C246,172 240,174 240,183 H252 C252,174 246,172 246,170 C246,168 252,166 252,157 Z"
        className="yd-study__hourglass-glass"
      />
      <path d="M241,162 C242,166 246,168 246,170 C246,168 250,166 251,162 Z M242,183 Q246,177 250,183 Z" className="yd-study__hourglass-sand" />
      <path d="M264,180 H292 L295,186 H261 Z" className="yd-study__notice" />
      <path d="M266,181.5 H290" className="yd-study__notice-band" />
      <path d="M268,184 L290,181" className="yd-study__pen" />
      <path d="M300,184 L304,168 H326 L330,184 Z" className="yd-study__machine" />
      <g className="yd-study__machine-keys">
        <circle cx="308" cy="174" r=".9" />
        <circle cx="313" cy="174" r=".9" />
        <circle cx="318" cy="174" r=".9" />
        <circle cx="323" cy="174" r=".9" />
        <circle cx="307" cy="179" r=".9" />
        <circle cx="312" cy="179" r=".9" />
        <circle cx="317" cy="179" r=".9" />
        <circle cx="322" cy="179" r=".9" />
      </g>
      <rect x="312" y="150" width="6" height="16" className="yd-study__tape" />
      <circle cx="315" cy="166" r="3.4" className="yd-study__roll" />

      <rect x="464" y="152" width="72" height="104" fill={url(ids.metal)} />
      <path d="M466,186 H534 M466,220 H534" className="yd-study__cabinet-lines" />
      <g className="yd-study__cabinet-handles">
        <rect x="490" y="170" width="20" height="3" rx="1" />
        <rect x="490" y="204" width="20" height="3" rx="1" />
        <rect x="490" y="238" width="20" height="3" rx="1" />
      </g>
      <g className="yd-study__cabinet-labels">
        <rect x="494" y="160" width="12" height="6" />
        <rect x="494" y="194" width="12" height="6" />
        <rect x="494" y="228" width="12" height="6" />
      </g>
      <rect x="472" y="140" width="56" height="10" className="yd-study__envelope" />
      <rect x="476" y="128" width="48" height="10" className="yd-study__envelope" />
      <rect x="500" y="130" width="12" height="5" className="yd-study__envelope-window" />
      <circle cx="518" cy="144" r="2.2" className="yd-study__stamp" />
      <path d="M468,152 V136 H532 V152 M470,138 V124 H530 V138" className="yd-study__tray" />
      <rect x="464" y="124" width="72" height="132" className="yd-study__cabinet-shade" />
      <path d="M562,224 H594 L590,258 H566 Z" className="yd-study__basket" />
      <path d="M566,236 H590 M567,246 H589" className="yd-study__basket-wires" />
      <g className="yd-study__crumpled">
        <circle cx="572" cy="222" r="5" />
        <circle cx="582" cy="220" r="5.5" />
        <circle cx="589" cy="224" r="4" />
      </g>
      <g className="yd-study__floor-shadows">
        <ellipse cx="258" cy="259" rx="84" ry="3" />
        <ellipse cx="500" cy="258" rx="40" ry="3" />
        <ellipse cx="93" cy="258" rx="78" ry="3" />
      </g>
    </g>
  );
}
