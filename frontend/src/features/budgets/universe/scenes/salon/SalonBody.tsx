import type { SalonIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/**
 * The room: papered wall, parquet, the window (night in the dark theme, day
 * in the light one — `SalonScene.css`), the floor lamp, the television on its
 * console with the streaming box, the desk and the laptop, the sofa, the
 * coffee table, the gym bag and a plant. Decoration only; the screen shows a
 * film, never a figure — the only progress bar that means anything is the one
 * inside the television's lens.
 */
export function SalonBody({ ids }: { ids: SalonIds }) {
  return (
    <g className="yd-salon__room">
      <rect x="0" y="0" width="640" height="252" fill={url(ids.paper)} />
      <rect x="0" y="0" width="640" height="252" fill={url(ids.wall)} className="yd-salon__wall-tone" />
      <rect x="0" y="222" width="640" height="30" className="yd-salon__wainscot" />
      <path d="M0,222 H640" className="yd-salon__rail" />
      <rect x="0" y="252" width="640" height="110" fill={url(ids.parquet)} />
      <rect x="0" y="252" width="640" height="110" className="yd-salon__floor-shade" />
      <path d="M0,252 H640" className="yd-salon__skirting" />

      <rect x="26" y="46" width="96" height="140" rx="2" fill={url(ids.window)} />
      <g className="yd-salon__night-sky">
        <circle cx="42" cy="62" r=".9" />
        <circle cx="98" cy="78" r=".8" />
        <circle cx="60" cy="96" r=".7" />
        <circle cx="104" cy="140" r=".8" />
        <circle cx="96" cy="66" r="7" className="yd-salon__moon" />
      </g>
      <path d="M74,46 V186 M26,116 H122" className="yd-salon__window-bars" />
      <rect x="22" y="42" width="104" height="148" rx="3" className="yd-salon__window-frame" />
      <path d="M14,34 C20,90 18,150 12,196 L2,196 L2,34 Z" className="yd-salon__curtain" />
      <path d="M134,34 C128,90 130,150 136,196 L146,196 L146,34 Z" className="yd-salon__curtain" />
      <path d="M8,34 H140" className="yd-salon__curtain-rod" />

      <circle cx="176" cy="120" r="70" fill={url(ids.lamp)} className="yd-salon__lamp-glow" />
      <path d="M176,150 V250" className="yd-salon__lamp-stand" />
      <path d="M162,250 H190" className="yd-salon__lamp-foot" />
      <path d="M160,112 L192,112 L186,150 L166,150 Z" className="yd-salon__lampshade" />
      <path d="M166,150 L186,150" className="yd-salon__lamp-bulb" />

      <circle cx="340" cy="150" r="130" fill={url(ids.tvLight)} className="yd-salon__tv-glow" />
      <rect x="244" y="86" width="192" height="110" rx="4" className="yd-salon__tv-bezel" />
      <rect x="250" y="92" width="180" height="98" rx="1.5" fill={url(ids.screen)} className="yd-salon__screen" />
      <path
        d="M250,152 C290,140 320,146 350,138 C380,131 410,140 430,136 L430,190 L250,190 Z"
        className="yd-salon__film-land"
      />
      <circle cx="368" cy="126" r="9" className="yd-salon__film-sun" />
      <rect x="232" y="224" width="216" height="30" rx="2" fill={url(ids.wood)} />
      <path d="M232,238 H448 M304,224 V254 M376,224 V254" className="yd-salon__wood-lines" />
      <rect x="286" y="210" width="108" height="10" rx="4" className="yd-salon__soundbar" />
      <rect x="398" y="214" width="26" height="8" rx="2" className="yd-salon__box" />
      <circle cx="419" cy="218" r="1.2" className="yd-salon__box-led" />
      <path d="M240,254 V262 M440,254 V262" className="yd-salon__feet" />

      <path d="M520,160 H604 L600,226 H524 Z" className="yd-salon__desk" />
      <path d="M516,158 H608" className="yd-salon__desk-top" />
      <path d="M526,226 V252 M598,226 V252" className="yd-salon__desk-legs" />
      <path d="M530,156 L534,128 L572,128 L570,156 Z" className="yd-salon__laptop-lid" />
      <rect x="536" y="131" width="31" height="21" rx="1" className="yd-salon__laptop-screen" />
      <path d="M522,157 H582" className="yd-salon__laptop-base" />
      <rect x="584" y="140" width="10" height="16" rx="2" className="yd-salon__mug" />
      <path d="M586,140 C586,132 594,132 594,140" className="yd-salon__steam" />

      <path d="M466,300 C470,270 480,258 494,262 L494,318 L466,318 Z" fill={url(ids.sofa)} />
      <path d="M470,258 C520,248 590,248 640,254 L640,318 L470,318 Z" fill={url(ids.sofa)} />
      <path d="M480,286 C530,280 590,280 640,284 L640,318 L480,318 Z" className="yd-salon__seat" />
      <path d="M520,258 C530,270 526,282 522,286 M580,254 C590,268 586,280 582,286" className="yd-salon__seams" />
      <rect x="600" y="262" width="26" height="22" rx="6" className="yd-salon__cushion" transform="rotate(-8 613 273)" />

      <path d="M226,296 H390 L384,304 H232 Z" fill={url(ids.wood)} />
      <path d="M236,304 V336 M380,304 V336" className="yd-salon__table-legs" />
      <rect x="286" y="288" width="30" height="8" rx="1" className="yd-salon__magazine" transform="rotate(-6 301 292)" />
      <rect x="330" y="289" width="14" height="5" rx="2" className="yd-salon__remote" />
      <circle cx="360" cy="289" r="5" className="yd-salon__candle" />
      <rect x="357" y="279" width="6" height="10" rx="2" className="yd-salon__candle-top" />

      <path d="M66,318 C66,296 78,288 96,288 C114,288 126,296 126,318 Z" className="yd-salon__bag" />
      <path d="M78,290 C80,280 112,280 114,290" className="yd-salon__bag-handle" />
      <path d="M70,306 H122" className="yd-salon__bag-stripe" />
      <rect x="130" y="306" width="30" height="5" rx="2" className="yd-salon__bar" />
      <rect x="126" y="300" width="7" height="17" rx="2" className="yd-salon__plate" />
      <rect x="157" y="300" width="7" height="17" rx="2" className="yd-salon__plate" />
      <path d="M196,250 C190,230 200,212 214,208 C212,226 222,238 214,250 Z" className="yd-salon__leaf" />
      <path d="M202,250 C206,226 226,218 236,224 C224,232 222,244 220,250 Z" className="yd-salon__leaf-light" />
      <rect x="196" y="250" width="32" height="18" rx="3" className="yd-salon__pot" />
    </g>
  );
}
