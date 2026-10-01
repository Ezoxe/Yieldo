import type { NurseryIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/** A five-pointed star of the wallpaper's size, its top point at (x, y). */
function star(x: number, y: number): string {
  return `M${x},${y} l1,2 l2,.4 l-1.6,1.4 l.4,2 l-1.8,-1 l-1.8,1 l.4,-2 l-1.6,-1.4 l2,-.4 Z`;
}

/** The cot's bars, one every twelve units. */
const BARS = Array.from({ length: 13 }, (_, index) => 210 + index * 12)
  .map((x) => `M${x},165 V237`)
  .join(" ");

/**
 * The bedroom: starred wallpaper, a wooden floor and a round rug; the stars
 * the night light throws on the wall; the window, its curtains and the moon
 * (night in the dark theme, day in the light one — `NurseryScene.css`); the
 * changing table with the bottle, the nappies, the night light and the duck;
 * the cot, its blanket and its bear under the mobile; the dog asleep in its
 * basket; the chalkboard, the little desk with its globe, pencils and lamp,
 * and the satchel at its foot. Decoration only.
 */
export function NurseryBody({ ids }: { ids: NurseryIds }) {
  return (
    <g className="yd-nursery__room">
      <rect x="0" y="0" width="640" height="262" fill={url(ids.wallpaper)} />
      <rect x="0" y="252" width="640" height="10" className="yd-nursery__plinth" />
      <rect x="0" y="262" width="640" height="100" fill={url(ids.floor)} />
      <rect x="0" y="262" width="640" height="100" className="yd-nursery__floor-shade" />
      <ellipse cx="300" cy="298" rx="124" ry="22" className="yd-nursery__rug" />
      <g className="yd-nursery__rug-dots">
        <circle cx="230" cy="296" r="4" />
        <circle cx="270" cy="304" r="4" />
        <circle cx="312" cy="292" r="4" />
        <circle cx="352" cy="302" r="4" />
        <circle cx="388" cy="294" r="4" />
      </g>
      <g className="yd-nursery__thrown-stars">
        <path d={star(118, 96)} />
        <path d={star(168, 60)} />
        <circle cx="140" cy="128" r="1.3" />
        <circle cx="196" cy="100" r="1.1" />
      </g>
      <g className="yd-nursery__thrown-stars yd-nursery__thrown-stars--late">
        <path d={star(210, 52)} />
        <circle cx="96" cy="70" r="1.2" />
        <circle cx="182" cy="136" r="1.1" />
      </g>

      <rect x="384" y="52" width="86" height="98" fill={url(ids.window)} />
      <circle cx="448" cy="76" r="9" className="yd-nursery__moon" />
      <g className="yd-nursery__stars">
        <circle cx="400" cy="70" r=".8" />
        <circle cx="420" cy="96" r=".7" />
        <circle cx="458" cy="118" r=".8" />
      </g>
      <path d="M427,52 V150 M384,100 H470" className="yd-nursery__mullion" />
      <rect x="380" y="48" width="94" height="106" rx="2" className="yd-nursery__window-frame" />
      <rect x="376" y="152" width="102" height="6" rx="1" className="yd-nursery__sill" />
      <path d="M372,42 H482" className="yd-nursery__curtain-rail" />
      <path d="M374,42 C386,70 380,110 392,150 L372,154 Z" className="yd-nursery__curtain" />
      <path d="M480,42 C468,70 474,110 462,150 L482,154 Z" className="yd-nursery__curtain" />
      <path d="M384,104 H392 M462,104 H470" className="yd-nursery__tieback" />
      <ellipse cx="427" cy="190" rx="70" ry="40" fill={url(ids.moonlight)} className="yd-nursery__moonlight" />

      <rect x="18" y="170" width="158" height="86" className="yd-nursery__table" />
      <path d="M22,198 H172 M22,226 H172" className="yd-nursery__table-lines" />
      <circle cx="97" cy="184" r="2.4" className="yd-nursery__knob yd-nursery__knob--pink" />
      <circle cx="97" cy="212" r="2.4" className="yd-nursery__knob yd-nursery__knob--blue" />
      <circle cx="97" cy="240" r="2.4" className="yd-nursery__knob yd-nursery__knob--yellow" />
      <rect x="18" y="170" width="158" height="86" className="yd-nursery__table-shade" />
      <rect x="22" y="162" width="150" height="9" rx="4.5" className="yd-nursery__mat" />
      <rect x="22" y="162" width="150" height="9" rx="4.5" className="yd-nursery__mat-shade" />
      <path d="M80,130 Q80,124 84,124 Q88,124 88,130 Z" className="yd-nursery__teat" />
      <rect x="77" y="130" width="14" height="6" rx="1.5" className="yd-nursery__collar" />
      <rect x="75" y="136" width="18" height="27" rx="4" className="yd-nursery__bottle" />
      <rect x="75" y="146" width="18" height="17" rx="2" className="yd-nursery__milk" />
      <path d="M90,142 H93 M90,148 H93 M90,154 H93" className="yd-nursery__marks" />
      <rect x="104" y="145" width="30" height="5" rx="2" className="yd-nursery__nappy" />
      <rect x="104" y="150" width="30" height="5" rx="2" className="yd-nursery__nappy" />
      <rect x="104" y="155" width="30" height="5" rx="2" className="yd-nursery__nappy" />
      <ellipse cx="144" cy="150" rx="22" ry="16" fill={url(ids.warm)} className="yd-nursery__glow" />
      <path d="M138,162 Q138,150 146,148 Q140,154 144,162 Z" className="yd-nursery__night-light" />
      <path d="M152,162 C150,154 158,150 162,154 C164,150 172,152 170,158 C172,160 170,162 164,162 Z" className="yd-nursery__duck" />
      <path d="M168,154 L172,153" className="yd-nursery__beak" />

      <path d="M364,152 V90 H300" className="yd-nursery__mobile-arm" />
      <g className="yd-nursery__mobile">
        <path d="M282,96 H318 M286,96 V114 M300,96 V120 M314,96 V110" className="yd-nursery__mobile-strings" />
        <path d="M286,112 l2,4 l4,.6 l-3,2.8 l.8,4 l-3.8,-2 l-3.8,2 l.8,-4 l-3,-2.8 l4,-.6 Z" className="yd-nursery__mobile-star" />
        <path d="M303,118 A7,7 0 1 1 296,128 A5.5,5.5 0 1 0 303,118 Z" className="yd-nursery__mobile-moon" />
        <path d="M308,114 Q308,108 314,108 Q316,104 321,107 Q326,107 325,113 Z" className="yd-nursery__mobile-cloud" />
      </g>
      <rect x="192" y="150" width="8" height="108" rx="2" className="yd-nursery__cot" />
      <rect x="360" y="150" width="8" height="108" rx="2" className="yd-nursery__cot" />
      <rect x="196" y="220" width="168" height="16" rx="3" className="yd-nursery__mattress" />
      <path d="M200,226 Q260,214 330,222 L360,224 V236 H200 Z" className="yd-nursery__blanket" />
      <g className="yd-nursery__blanket-dots">
        <circle cx="232" cy="228" r="1.4" />
        <circle cx="262" cy="224" r="1.4" />
        <circle cx="298" cy="228" r="1.4" />
        <circle cx="330" cy="226" r="1.4" />
      </g>
      <path d="M322,222 C318,212 322,204 330,204 C338,204 342,212 338,222 Z" className="yd-nursery__bear" />
      <circle cx="324" cy="204" r="4" className="yd-nursery__bear" />
      <circle cx="336" cy="204" r="4" className="yd-nursery__bear" />
      <circle cx="327" cy="211" r="1" className="yd-nursery__eye" />
      <circle cx="333" cy="211" r="1" className="yd-nursery__eye" />
      <path d="M200,162 H360 M200,240 H360" className="yd-nursery__cot-rails" />
      <path d={BARS} className="yd-nursery__cot-bars" />
      <rect x="190" y="148" width="180" height="112" className="yd-nursery__cot-shade" />

      <ellipse cx="430" cy="254" rx="38" ry="9" className="yd-nursery__basket" />
      <path d="M392,252 Q430,236 468,252" className="yd-nursery__basket-rim" />
      <ellipse cx="430" cy="250" rx="32" ry="6" className="yd-nursery__cushion" />
      <path d="M410,248 C410,236 424,232 436,234 C448,236 452,244 450,250 Z" className="yd-nursery__dog" />
      <path d="M444,240 C448,236 456,238 454,244 C452,248 446,248 444,246 Z" className="yd-nursery__dog" />
      <path d="M450,240 L454,234 L456,242 Z" className="yd-nursery__dog-ear" />
      <path d="M412,248 C406,246 404,240 410,240" className="yd-nursery__dog-tail" />
      <circle cx="453" cy="243" r=".9" className="yd-nursery__eye" />
      <ellipse cx="482" cy="258" rx="8" ry="3" className="yd-nursery__bowl" />

      <rect x="500" y="70" width="110" height="66" rx="2" className="yd-nursery__board-frame" />
      <rect x="504" y="74" width="102" height="58" className="yd-nursery__board" />
      <path
        d="M512,98 L518,84 L524,98 M514,92 H522 M530,84 V98 M530,84 Q540,86 530,91 Q541,93 530,98 M554,86 Q545,91 554,98 M572,96 L578,88 L584,96 V104 H572 Z M513,113 L516,110 V124 M522,117 H530 M526,113 V121 M535,112 Q541,109 541,114 Q541,118 535,124 H542"
        className="yd-nursery__chalk"
      />
      <circle cx="592" cy="86" r="4" className="yd-nursery__chalk" />
      <rect x="502" y="132" width="106" height="4" className="yd-nursery__chalk-tray" />
      <rect x="486" y="196" width="144" height="7" rx="1" className="yd-nursery__desk" />
      <path d="M492,203 V258 M624,203 V258" className="yd-nursery__desk-legs" />
      <circle cx="572" cy="180" r="13" className="yd-nursery__globe" />
      <path d="M564,172 Q570,176 568,184 Q574,186 578,180 Q580,174 576,170" className="yd-nursery__land" />
      <path d="M572,193 V196 M564,196 H580" className="yd-nursery__globe-stand" />
      <path d="M585,168 A15,15 0 0 0 572,195" className="yd-nursery__meridian" />
      <rect x="508" y="184" width="12" height="12" rx="1" className="yd-nursery__pencil-pot" />
      <path d="M510,184 L509,174" className="yd-nursery__pencil yd-nursery__pencil--blue" />
      <path d="M513,184 L513,172" className="yd-nursery__pencil yd-nursery__pencil--green" />
      <path d="M516,184 L517,175" className="yd-nursery__pencil yd-nursery__pencil--red" />
      <path d="M518,184 L520,176" className="yd-nursery__pencil yd-nursery__pencil--yellow" />
      <ellipse cx="612" cy="190" rx="24" ry="12" fill={url(ids.warm)} className="yd-nursery__glow" />
      <path d="M606,196 V180 Q606,172 614,172" className="yd-nursery__lamp-arm" />
      <circle cx="616" cy="172" r="6" className="yd-nursery__lamp-head" />
      <rect x="504" y="218" width="38" height="40" rx="5" className="yd-nursery__satchel" />
      <path d="M504,226 H542 V238 Q523,242 504,238 Z" className="yd-nursery__satchel-flap" />
      <rect x="512" y="236" width="5" height="6" rx="1" className="yd-nursery__buckle" />
      <rect x="529" y="236" width="5" height="6" rx="1" className="yd-nursery__buckle" />
      <path d="M514,218 Q523,208 532,218" className="yd-nursery__satchel-handle" />
      <g className="yd-nursery__floor-shadows">
        <ellipse cx="97" cy="259" rx="80" ry="3" />
        <ellipse cx="280" cy="261" rx="92" ry="3" />
        <ellipse cx="558" cy="260" rx="70" ry="3" />
      </g>
    </g>
  );
}
