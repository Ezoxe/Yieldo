import type { DressingIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/**
 * The dressing room: striped wallpaper over a pale oak floor and a round rug;
 * the open wardrobe with its hat box, sweaters and shoe box, the clothes rail,
 * the shoes and the drawers; the cheval mirror; the armchair and its cushion
 * under the arc lamp (lit at dusk in the dark theme, off by day in the light
 * one — `DressingScene.css`); the pile of presents; the chest of drawers with
 * the laptop, the headphones and a vase under a print. Decoration only.
 */
export function DressingBody({ ids }: { ids: DressingIds }) {
  return (
    <g className="yd-dressing__room">
      <rect x="0" y="0" width="640" height="262" fill={url(ids.wallpaper)} />
      <rect x="0" y="252" width="640" height="10" className="yd-dressing__plinth" />
      <rect x="0" y="262" width="640" height="100" fill={url(ids.floor)} />
      <rect x="0" y="262" width="640" height="100" className="yd-dressing__floor-shade" />
      <ellipse cx="330" cy="294" rx="128" ry="24" className="yd-dressing__rug" />
      <ellipse cx="330" cy="294" rx="116" ry="19" className="yd-dressing__rug-border" />
      <ellipse cx="122" cy="70" rx="110" ry="70" fill={url(ids.warm)} className="yd-dressing__glow" />
      <ellipse cx="550" cy="80" rx="90" ry="60" fill={url(ids.warm)} className="yd-dressing__glow" />

      <rect x="16" y="58" width="212" height="198" className="yd-dressing__carcass" />
      <rect x="24" y="66" width="196" height="184" className="yd-dressing__interior" />
      <rect x="36" y="84" width="34" height="18" className="yd-dressing__hatbox" />
      <ellipse cx="53" cy="84" rx="17" ry="3" className="yd-dressing__hatbox-lid" />
      <rect x="150" y="95" width="36" height="7" className="yd-dressing__sweater yd-dressing__sweater--navy" />
      <rect x="152" y="88" width="34" height="7" className="yd-dressing__sweater yd-dressing__sweater--mustard" />
      <rect x="150" y="81" width="36" height="7" className="yd-dressing__sweater yd-dressing__sweater--plum" />
      <rect x="192" y="88" width="24" height="14" className="yd-dressing__shoebox" />
      <rect x="24" y="102" width="196" height="4" className="yd-dressing__carcass" />
      <path d="M26,136 H218" className="yd-dressing__rail" />
      <path
        d="M36.5,137 a1.5,1.5 0 1 1 3,0 M58.5,137 a1.5,1.5 0 1 1 3,0 M76.5,137 a1.5,1.5 0 1 1 3,0 M168.5,137 a1.5,1.5 0 1 1 3,0 M188.5,137 a1.5,1.5 0 1 1 3,0 M207.5,137 a1.5,1.5 0 1 1 3,0"
        className="yd-dressing__hooks"
      />
      <path d="M31,141 L26,146 L27,154 L30,153 L30,216 H46 V153 L49,154 L50,146 L45,141 Z" className="yd-dressing__garment yd-dressing__garment--camel" />
      <path d="M34,141 L38,150 L42,141" className="yd-dressing__collar" />
      <path d="M53,141 L49,145 L51,150 L54,148 V188 H66 V148 L69,150 L71,145 L67,141 Z" className="yd-dressing__garment yd-dressing__garment--navy" />
      <path d="M60,144 V188" className="yd-dressing__placket" />
      <path d="M73,141 L70,144 L72,154 L66,208 H90 L84,154 L86,144 L83,141 Z" className="yd-dressing__garment yd-dressing__garment--red" />
      <path d="M163,141 L159,145 L160,156 L163,155 V190 H177 V155 L180,156 L181,145 L177,141 Z" className="yd-dressing__garment yd-dressing__garment--denim" />
      <path d="M183,141 L179,145 L181,150 L184,148 V192 H196 V148 L199,150 L201,145 L197,141 Z" className="yd-dressing__garment yd-dressing__garment--white" />
      <path d="M204,141 L201,144 L203,154 L198,212 H220 L215,154 L217,144 L214,141 Z" className="yd-dressing__garment yd-dressing__garment--black" />
      <rect x="24" y="226" width="196" height="4" className="yd-dressing__carcass" />
      <path d="M32,226 C32,220 40,218 46,222 L52,224 V226 Z M54,226 C54,220 62,218 68,222 L74,224 V226 Z" className="yd-dressing__sneakers" />
      <path d="M98,226 L100,218 Q108,216 114,222 L124,224 V226 Z" className="yd-dressing__heels" />
      <path d="M170,226 V206 H179 V218 Q189,218 196,222 V226 Z" className="yd-dressing__boots" />
      <rect x="26" y="232" width="94" height="16" className="yd-dressing__drawer" />
      <rect x="124" y="232" width="94" height="16" className="yd-dressing__drawer" />
      <circle cx="73" cy="240" r="1.6" className="yd-dressing__knob" />
      <circle cx="171" cy="240" r="1.6" className="yd-dressing__knob" />
      <rect x="16" y="58" width="212" height="198" className="yd-dressing__wardrobe-shade" />

      <path d="M270,222 L262,258 M298,222 L306,258" className="yd-dressing__mirror-stand" />
      <ellipse cx="284" cy="150" rx="28" ry="72" fill={url(ids.glass)} className="yd-dressing__mirror-frame" />
      <path d="M268,112 L298,88" className="yd-dressing__streak" />
      <path d="M272,132 L300,112" className="yd-dressing__streak yd-dressing__streak--faint" />

      <ellipse cx="352" cy="257" rx="12" ry="3.5" className="yd-dressing__lamp-base" />
      <path d="M352,255 V150 Q352,72 396,94" className="yd-dressing__lamp-pole" />
      <ellipse cx="396" cy="156" rx="46" ry="54" fill={url(ids.warm)} className="yd-dressing__glow" />
      <path d="M380,112 A16,16 0 0 1 412,112 Z" className="yd-dressing__dome" />
      <path d="M383,112 H409" className="yd-dressing__bulb" />
      <path d="M344,208 V172 Q344,160 356,160 H406 Q418,160 418,172 V208 Z" className="yd-dressing__chair-back" />
      <rect x="336" y="204" width="90" height="22" rx="6" className="yd-dressing__chair-seat" />
      <rect x="330" y="190" width="16" height="42" rx="6" className="yd-dressing__chair-arm" />
      <rect x="416" y="190" width="16" height="42" rx="6" className="yd-dressing__chair-arm" />
      <path d="M340,232 L338,256 M422,232 L424,256" className="yd-dressing__chair-legs" />
      <rect x="366" y="186" width="32" height="20" rx="6" transform="rotate(-6 382 196)" className="yd-dressing__cushion" />

      <rect x="438" y="230" width="36" height="32" className="yd-dressing__gift yd-dressing__gift--red" />
      <path d="M453,230 h6 v32 h-6 Z M438,243 h36 v6 h-36 Z" className="yd-dressing__ribbon yd-dressing__ribbon--gold" />
      <rect x="443" y="210" width="26" height="20" className="yd-dressing__gift yd-dressing__gift--navy" />
      <path d="M454,210 h4 v20 h-4 Z M443,218 h26 v4 h-26 Z" className="yd-dressing__ribbon yd-dressing__ribbon--white" />
      <rect x="449" y="198" width="14" height="12" className="yd-dressing__gift yd-dressing__gift--mint" />
      <rect x="455" y="198" width="2" height="12" className="yd-dressing__ribbon yd-dressing__ribbon--red" />
      <path d="M456,198 C450,190 446,196 456,198 C466,196 462,190 456,198 Z" className="yd-dressing__bow" />

      <rect x="508" y="56" width="88" height="68" className="yd-dressing__print-frame" />
      <rect x="512" y="60" width="80" height="60" className="yd-dressing__print" />
      <path d="M528,120 V98 A12,12 0 0 1 552,98 V120 Z" className="yd-dressing__print-arch yd-dressing__print-arch--terracotta" />
      <path d="M556,120 V104 A10,10 0 0 1 576,104 V120 Z" className="yd-dressing__print-arch yd-dressing__print-arch--mustard" />
      <circle cx="578" cy="76" r="6" className="yd-dressing__print-sun" />
      <rect x="508" y="56" width="88" height="68" className="yd-dressing__print-shade" />
      <rect x="484" y="188" width="146" height="6" className="yd-dressing__dresser-top" />
      <rect x="488" y="194" width="138" height="56" className="yd-dressing__dresser" />
      <path d="M492,213 H622 M492,232 H622 M557,194 V213" className="yd-dressing__dresser-lines" />
      <circle cx="522" cy="203" r="1.8" className="yd-dressing__knob" />
      <circle cx="592" cy="203" r="1.8" className="yd-dressing__knob" />
      <circle cx="557" cy="222" r="1.8" className="yd-dressing__knob" />
      <circle cx="557" cy="241" r="1.8" className="yd-dressing__knob" />
      <path d="M494,250 L496,258 M620,250 L618,258" className="yd-dressing__dresser-legs" />
      <path d="M516,186 H580 L584,190 H512 Z" className="yd-dressing__laptop-base" />
      <rect x="520" y="148" width="56" height="38" rx="2" className="yd-dressing__bezel" />
      <rect x="523" y="151" width="50" height="32" className="yd-dressing__display" />
      <rect x="528" y="156" width="24" height="14" className="yd-dressing__display-window" />
      <rect x="597" y="160" width="2" height="28" className="yd-dressing__stand" />
      <ellipse cx="598" cy="188" rx="7" ry="2" className="yd-dressing__stand" />
      <path d="M588,166 Q598,150 608,166" className="yd-dressing__headband" />
      <rect x="585" y="164" width="6" height="12" rx="2" className="yd-dressing__cup" />
      <rect x="605" y="164" width="6" height="12" rx="2" className="yd-dressing__cup" />
      <path d="M616,188 C612,180 614,170 619,166 C624,170 626,180 622,188 Z" className="yd-dressing__vase" />
      <path d="M619,166 L613,142 M619,166 L626,146" className="yd-dressing__branch" />
      <circle cx="614" cy="146" r="1.6" className="yd-dressing__leaf" />
      <circle cx="616" cy="152" r="1.4" className="yd-dressing__leaf" />
      <circle cx="625" cy="150" r="1.6" className="yd-dressing__leaf" />

      <g className="yd-dressing__floor-shadows">
        <ellipse cx="456" cy="263" rx="24" ry="2.5" />
        <ellipse cx="557" cy="259" rx="72" ry="3" />
        <ellipse cx="381" cy="258" rx="50" ry="3" />
      </g>
    </g>
  );
}
