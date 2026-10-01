import type { ClinicIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/** A Greek cross, arms `arm` wide, `size` across, centred on (cx, cy). */
function cross(cx: number, cy: number, size: number, arm: number): string {
  const h = size / 2;
  const a = arm / 2;
  return (
    `M${cx - a},${cy - h} H${cx + a} V${cy - a} H${cx + h} V${cy + a} H${cx + a} V${cy + h} ` +
    `H${cx - a} V${cy + a} H${cx - h} V${cy - a} H${cx - a} Z`
  );
}

/**
 * The office: sage walls and a vinyl floor; the window with its blind half
 * down and, across the street, the pharmacy's green cross (dusk in the dark
 * theme, day in the light one — `ClinicScene.css`); two diplomas, the white
 * coat on its hook, the eye chart over the glasses shelf; the medicine cabinet
 * over the washbasin, a plant; the desk with its lamp, stethoscope, screen and
 * card reader, the doctor's chair behind it; the examination table with its
 * paper roll. Decoration only.
 */
export function ClinicBody({ ids }: { ids: ClinicIds }) {
  return (
    <g className="yd-clinic__room">
      <rect x="0" y="0" width="640" height="262" fill={url(ids.wall)} />
      <rect x="0" y="254" width="640" height="8" className="yd-clinic__plinth" />
      <rect x="0" y="262" width="640" height="100" fill={url(ids.floor)} />
      <rect x="0" y="262" width="640" height="100" className="yd-clinic__floor-shade" />

      <rect x="246" y="52" width="120" height="88" fill={url(ids.window)} />
      <g className="yd-clinic__stars">
        <circle cx="262" cy="90" r=".8" />
        <circle cx="292" cy="87" r=".7" />
        <circle cx="352" cy="92" r=".8" />
      </g>
      <rect x="246" y="98" width="120" height="42" className="yd-clinic__facade" />
      <path d="M246,98 H366" className="yd-clinic__cornice" />
      <rect x="256" y="108" width="8" height="11" className="yd-clinic__pane" />
      <rect x="276" y="108" width="8" height="11" className="yd-clinic__pane yd-clinic__pane--dark" />
      <rect x="256" y="126" width="8" height="11" className="yd-clinic__pane yd-clinic__pane--dark" />
      <rect x="288" y="126" width="8" height="11" className="yd-clinic__pane" />
      <path d="M366,112 H346" className="yd-clinic__bracket" />
      <circle cx="335" cy="112" r="16" fill={url(ids.green)} className="yd-clinic__sign-glow" />
      <path d={cross(335, 112, 18, 6)} className="yd-clinic__sign" />
      <rect x="246" y="52" width="120" height="30" fill={url(ids.blind)} />
      <rect x="244" y="81" width="124" height="3" rx="1" className="yd-clinic__blind-rail" />
      <path d="M360,84 V104" className="yd-clinic__blind-cord" />
      <path d="M306,84 V140" className="yd-clinic__mullion" />
      <rect x="242" y="48" width="128" height="96" rx="3" className="yd-clinic__window-frame" />
      <rect x="238" y="142" width="136" height="6" rx="1" className="yd-clinic__sill" />

      <rect x="398" y="62" width="34" height="42" rx="1" className="yd-clinic__diploma-frame" />
      <rect x="402" y="66" width="26" height="34" className="yd-clinic__diploma" />
      <path d="M406,73 H424 M406,79 H422 M406,84 H418" className="yd-clinic__diploma-text" />
      <circle cx="422" cy="93" r="3" className="yd-clinic__seal" />
      <rect x="440" y="62" width="34" height="42" rx="1" className="yd-clinic__diploma-frame" />
      <rect x="444" y="66" width="26" height="34" className="yd-clinic__diploma" />
      <path d="M448,73 H466 M448,79 H464 M448,84 H460" className="yd-clinic__diploma-text" />
      <circle cx="464" cy="93" r="3" className="yd-clinic__seal" />

      <path d="M510,66 V62 Q510,58 514,58" className="yd-clinic__hook" />
      <path d="M496,80 L510,68 L524,80" className="yd-clinic__hanger" />
      <path d="M496,78 Q510,72 524,78 L534,92 L538,178 Q510,184 482,178 L486,92 Z" className="yd-clinic__coat" />
      <path d="M486,92 L480,150 L487,152 L492,104 Z M534,92 L540,150 L533,152 L528,104 Z" className="yd-clinic__sleeve" />
      <path d="M503,77 L510,108 L517,77 M510,108 V180" className="yd-clinic__seam" />
      <circle cx="512.5" cy="120" r="1.2" className="yd-clinic__button" />
      <circle cx="512.5" cy="138" r="1.2" className="yd-clinic__button" />
      <circle cx="512.5" cy="156" r="1.2" className="yd-clinic__button" />
      <rect x="518" y="114" width="12" height="12" rx="1" className="yd-clinic__pocket" />
      <path d="M521,110 V118" className="yd-clinic__coat-pen" />
      <path
        d="M496,78 Q510,72 524,78 L534,92 L540,150 L538,178 Q510,184 482,178 L480,150 L486,92 Z"
        className="yd-clinic__coat-shade"
      />

      <rect x="556" y="46" width="56" height="104" rx="2" className="yd-clinic__chart" />
      <rect x="578" y="53" width="12" height="11" rx="1" className="yd-clinic__letter" />
      <g className="yd-clinic__letters">
        <path d="M571,75 H597" strokeWidth="8" strokeDasharray="6 4" />
        <path d="M569.5,88 H598.5" strokeWidth="6" strokeDasharray="5 3" />
        <path d="M568,98.5 H600" strokeWidth="5" strokeDasharray="4 3" />
        <path d="M567.3,108 H600.7" strokeWidth="4" strokeDasharray="3.4 2.6" />
        <path d="M567.5,116.5 H600.5" strokeWidth="3" strokeDasharray="3 2" />
        <path d="M567.5,123.5 H600.5" strokeWidth="3" strokeDasharray="3 2" />
        <path d="M567.4,130.2 H600.6" strokeWidth="2.4" strokeDasharray="2.4 2" />
        <path d="M567.4,136.1 H600.6" strokeWidth="2.2" strokeDasharray="2.4 2" />
        <path d="M567.8,142 H600.2" strokeWidth="2" strokeDasharray="2 1.8" />
      </g>
      <rect x="556" y="46" width="56" height="104" rx="2" className="yd-clinic__chart-shade" />
      <rect x="546" y="170" width="76" height="4" rx="1" className="yd-clinic__shelf" />
      <path d="M556,174 L560,182 M612,174 L608,182" className="yd-clinic__shelf-bracket" />
      <circle cx="567" cy="164" r="4.4" className="yd-clinic__glass" />
      <circle cx="580" cy="164" r="4.4" className="yd-clinic__glass" />
      <circle cx="567" cy="164" r="5" className="yd-clinic__frames" />
      <circle cx="580" cy="164" r="5" className="yd-clinic__frames" />
      <path d="M572,163 Q573.5,161 575,163" className="yd-clinic__frames" />
      <path
        d="M592,153 C592,149 595,148 597.5,150 C600,148 603,149 603,153 C603,158 601,159 601,163 L600,167 C599.5,169 598,168 598,166 L597.5,162 L597,166 C597,168 595.5,169 595,167 L594,163 C594,159 592,158 592,153 Z"
        className="yd-clinic__tooth"
      />
      <rect x="593" y="167" width="9" height="3" rx="1" className="yd-clinic__tooth-stand" />

      <rect x="34" y="100" width="104" height="114" rx="4" fill={url(ids.enamel)} />
      <rect x="40" y="106" width="92" height="102" rx="2" className="yd-clinic__cabinet-door" />
      <path d="M126,150 V172" className="yd-clinic__cabinet-handle" />
      <rect x="34" y="100" width="104" height="114" rx="4" className="yd-clinic__cabinet-shade" />
      <path d={cross(86, 116, 16, 5.5)} className="yd-clinic__cross" />
      <rect x="44" y="220" width="84" height="6" rx="2" className="yd-clinic__sink-rim" />
      <path d="M46,226 H126 L120,240 Q86,248 52,240 Z" className="yd-clinic__basin" />
      <path d="M80,242 L83,262 H89 L92,242 Z" className="yd-clinic__pedestal" />
      <path d="M100,220 V216 Q100,214 96,214 H92" className="yd-clinic__tap" />
      <path d="M44,220 H128 V226 H126 L120,240 Q86,248 52,240 L46,226 H44 Z" className="yd-clinic__sink-shade" />

      <g className="yd-clinic__floor-shadows">
        <ellipse cx="304" cy="301" rx="132" ry="4" />
        <ellipse cx="540" cy="301" rx="96" ry="3.5" />
        <ellipse cx="159" cy="301" rx="14" ry="2.5" />
      </g>
      <path d="M148,278 H170 L166,300 H152 Z" className="yd-clinic__pot" />
      <path
        d="M159,278 C150,264 144,250 148,236 C156,248 160,262 159,278 Z M159,278 C162,260 168,248 174,242 C174,256 168,268 159,278 Z M159,278 C155,262 157,246 163,230 C166,246 164,262 159,278 Z"
        className="yd-clinic__leaves"
      />

      <path d="M330,206 V172 Q330,160 342,160 H360 Q372,160 372,172 V206 Z" className="yd-clinic__chair" />
      <path d="M336,170 H366" className="yd-clinic__chair-seam" />
      <path d="M184,198 H424 L432,212 H176 Z" className="yd-clinic__desk-top" />
      <rect x="176" y="212" width="256" height="7" className="yd-clinic__desk-edge" />
      <rect x="182" y="219" width="244" height="81" fill={url(ids.wood)} />
      <path d="M360,219 V300 M360,246 H426 M360,273 H426" className="yd-clinic__drawers" />
      <path d="M386,232 H400 M386,259 H400 M386,286 H400" className="yd-clinic__handles" />

      <path d="M210,176 L224,170 L254,206 L196,207 Z" className="yd-clinic__lamp-cone" />
      <ellipse cx="224" cy="206" rx="38" ry="8" fill={url(ids.lamp)} className="yd-clinic__lamp-pool" />
      <ellipse cx="192" cy="206" rx="8" ry="2.4" className="yd-clinic__lamp-base" />
      <path d="M192,205 L198,178 L210,166" className="yd-clinic__lamp-arm" />
      <path d="M204,163 L216,159 L224,170 L210,176 Z" className="yd-clinic__lamp-shade" />
      <path d="M210,176 L224,170" className="yd-clinic__bulb" />
      <path d="M238,201 H258 L260,209 H236 Z" className="yd-clinic__pad" />
      <path d="M242,203.5 H254 M241,206 H252" className="yd-clinic__pad-lines" />
      <path d="M244,200 L262,204" className="yd-clinic__desk-pen" />
      <path d="M208,208 C202,203 207,199 215,201 C223,203 223,209 231,209" className="yd-clinic__tubing" />
      <ellipse cx="234" cy="208" rx="4.5" ry="2.2" className="yd-clinic__chestpiece" />
      <path d="M208,208 L201,205 M208,208 L202,211" className="yd-clinic__binaural" />
      <rect x="268" y="148" width="64" height="44" rx="3" className="yd-clinic__bezel" />
      <rect x="272" y="152" width="56" height="34" rx="1.5" className="yd-clinic__screen" />
      <path d="M278,160 H318 M278,167 H310 M278,174 H314 M278,181 H302" className="yd-clinic__agenda" />
      <rect x="297" y="192" width="6" height="9" className="yd-clinic__stand" />
      <ellipse cx="300" cy="202" rx="14" ry="2.6" className="yd-clinic__stand" />
      <path d="M276,206 H322 L325,210 H273 Z" className="yd-clinic__keyboard" />
      <path d="M372,184 H390 L392,204 H370 Z" className="yd-clinic__terminal" />
      <rect x="375" y="187" width="12" height="5" rx="1" className="yd-clinic__terminal-screen" />
      <rect x="375" y="203" width="12" height="7" rx="1" className="yd-clinic__card" />
      <rect x="375" y="206" width="12" height="1.6" className="yd-clinic__card-stripe" />

      <path d="M472,240 H478 V300 H472 Z M600,240 H606 V300 H600 Z M472,282 H606 V286 H472 Z" className="yd-clinic__table-frame" />
      <rect x="452" y="228" width="176" height="15" rx="4" fill={url(ids.leather)} />
      <rect x="466" y="224" width="162" height="6" rx="1" className="yd-clinic__paper" />
      <path d="M452,216 V232" className="yd-clinic__roll-holder" />
      <circle cx="460" cy="222" r="8" className="yd-clinic__paper" />
      <circle cx="460" cy="222" r="2.6" className="yd-clinic__roll-core" />
    </g>
  );
}
