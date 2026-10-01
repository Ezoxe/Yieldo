import type { HallIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/**
 * The hall: a moulded wall over a parquet floor, a pendant light; the front
 * door, its glass showing the street (dusk in the dark theme, day in the
 * light one — `HallScene.css`), the doormat; the guitar on its stand; the
 * console with its lamp, key bowl and trainers under the cork board; the
 * coat rack with a coat, a cap and a scarf over the cabin suitcase; a concert
 * poster over the bike. Decoration only.
 */
export function HallBody({ ids }: { ids: HallIds }) {
  return (
    <g className="yd-hall__room">
      <rect x="0" y="0" width="640" height="262" fill={url(ids.wall)} />
      <g className="yd-hall__moulding">
        <rect x="142" y="24" width="102" height="150" />
        <rect x="376" y="24" width="92" height="150" />
        <rect x="478" y="24" width="150" height="150" />
        <rect x="12" y="198" width="116" height="46" />
        <rect x="142" y="198" width="102" height="46" />
        <rect x="376" y="198" width="92" height="46" />
        <rect x="478" y="198" width="150" height="46" />
      </g>
      <path d="M0,186 H640" className="yd-hall__dado" />
      <rect x="0" y="252" width="640" height="10" className="yd-hall__plinth" />
      <rect x="0" y="262" width="640" height="100" fill={url(ids.parquet)} />
      <rect x="0" y="262" width="640" height="100" className="yd-hall__floor-shade" />

      <ellipse cx="310" cy="64" rx="130" ry="78" fill={url(ids.warm)} className="yd-hall__glow" />
      <path d="M310,0 V22" className="yd-hall__cord" />
      <path d="M298,34 Q298,22 310,22 Q322,22 322,34 Z" className="yd-hall__pendant" />
      <path d="M300,34 H320" className="yd-hall__bulb" />

      <rect x="254" y="58" width="112" height="204" className="yd-hall__door-frame" />
      <rect x="262" y="66" width="96" height="196" fill={url(ids.door)} />
      <rect x="276" y="80" width="68" height="76" rx="2" fill={url(ids.window)} />
      <circle cx="330" cy="104" r="14" fill={url(ids.warm)} className="yd-hall__street-glow" />
      <path d="M330,99 V156" className="yd-hall__lamp-post" />
      <rect x="326" y="94" width="8" height="5" rx="1" className="yd-hall__street-lamp" />
      <g className="yd-hall__stars">
        <circle cx="288" cy="90" r=".8" />
        <circle cx="300" cy="100" r=".7" />
      </g>
      <path d="M310,80 V156 M276,118 H344" className="yd-hall__glazing" />
      <rect x="276" y="172" width="30" height="72" className="yd-hall__door-panel" />
      <rect x="314" y="172" width="30" height="72" className="yd-hall__door-panel" />
      <circle cx="346" cy="168" r="3" className="yd-hall__rosette" />
      <path d="M346,168 H356" className="yd-hall__door-handle" />
      <rect x="345" y="177" width="2" height="4" rx="1" className="yd-hall__keyhole" />
      <rect x="254" y="58" width="112" height="204" className="yd-hall__door-shade" />
      <rect x="268" y="264" width="84" height="12" rx="2" className="yd-hall__mat" />
      <path d="M272,268 H348 M272,272 H348" className="yd-hall__mat-lines" />

      <rect x="138" y="92" width="110" height="84" rx="2" className="yd-hall__board-frame" />
      <rect x="142" y="96" width="102" height="76" className="yd-hall__cork" />
      <rect x="142" y="96" width="102" height="76" className="yd-hall__board-shade" />
      <g transform="rotate(-8 156 106)">
        <rect x="146" y="100" width="22" height="11" rx="1" className="yd-hall__pinned-ticket" />
        <path d="M161,100 V111" className="yd-hall__perforation" />
      </g>
      <rect x="222" y="100" width="20" height="16" className="yd-hall__card" />
      <rect x="224" y="102" width="16" height="6" className="yd-hall__card-sky" />
      <rect x="224" y="108" width="16" height="2" className="yd-hall__card-sea" />
      <rect x="224" y="110" width="16" height="4" className="yd-hall__card-sand" />
      <rect x="224" y="140" width="17" height="22" className="yd-hall__card" />
      <rect x="226" y="142" width="13" height="13" className="yd-hall__photo" />
      <circle cx="150" cy="103" r="1.6" className="yd-hall__pin yd-hall__pin--red" />
      <circle cx="232" cy="102" r="1.6" className="yd-hall__pin yd-hall__pin--blue" />
      <circle cx="232" cy="142" r="1.6" className="yd-hall__pin yd-hall__pin--green" />

      <ellipse cx="160" cy="166" rx="46" ry="34" fill={url(ids.warm)} className="yd-hall__glow" />
      <rect x="140" y="190" width="100" height="7" rx="1" className="yd-hall__console-top" />
      <rect x="144" y="197" width="92" height="9" className="yd-hall__console-apron" />
      <circle cx="190" cy="201.5" r="1.6" className="yd-hall__brass" />
      <path d="M148,206 L150,262 M232,206 L230,262" className="yd-hall__console-legs" />
      <rect x="146" y="238" width="88" height="4" className="yd-hall__console-apron" />
      <path
        d="M158,238 C158,232 166,230 172,234 L178,236 V238 Z M180,238 C180,232 188,230 194,234 L200,236 V238 Z"
        className="yd-hall__trainers"
      />
      <path d="M158,237 H178 M180,237 H200" className="yd-hall__trainer-stripe" />
      <ellipse cx="160" cy="190" rx="7" ry="2" className="yd-hall__lamp-base" />
      <rect x="159" y="166" width="2" height="24" className="yd-hall__brass" />
      <path d="M152,150 H168 L172,166 H148 Z" className="yd-hall__lampshade" />
      <ellipse cx="214" cy="188" rx="10" ry="3" className="yd-hall__bowl" />
      <path d="M210,186 L214,182 M216,186 L219,183" className="yd-hall__keys" />

      <path d="M70,262 L80,242 M102,262 L92,242" className="yd-hall__stand" />
      <rect x="82" y="150" width="8" height="34" className="yd-hall__neck" />
      <path d="M82,156 H90 M82,163 H90 M82,170 H90 M82,177 H90" className="yd-hall__frets" />
      <path d="M80,136 H92 L91,150 H81 Z" className="yd-hall__headstock" />
      <g className="yd-hall__pegs">
        <circle cx="79" cy="140" r="1.3" />
        <circle cx="79" cy="145" r="1.3" />
        <circle cx="93" cy="140" r="1.3" />
        <circle cx="93" cy="145" r="1.3" />
      </g>
      <ellipse cx="86" cy="198" rx="19" ry="16" fill={url(ids.wood)} className="yd-hall__guitar-edge" />
      <ellipse cx="86" cy="232" rx="26" ry="23" fill={url(ids.wood)} className="yd-hall__guitar-edge" />
      <rect x="68" y="196" width="36" height="20" fill={url(ids.wood)} />
      <circle cx="86" cy="204" r="6.5" className="yd-hall__soundhole" />
      <rect x="76" y="236" width="20" height="4" rx="1" className="yd-hall__bridge" />
      <path d="M83,150 L82,238 M84.5,150 L84,238 M86,150 V238 M87.5,150 L88,238 M89,150 L90,238" className="yd-hall__strings" />

      <rect x="382" y="86" width="80" height="6" rx="1" className="yd-hall__rack" />
      <path d="M398,92 V97 M422,92 V97 M446,92 V97" className="yd-hall__hooks" />
      <path d="M398,97 L388,104 L382,176 Q398,182 416,176 L410,104 Z" className="yd-hall__coat" />
      <path d="M398,97 L394,120 M398,97 L402,120 M383,140 H415" className="yd-hall__coat-seams" />
      <ellipse cx="422" cy="102" rx="8" ry="4.5" className="yd-hall__cap" />
      <path d="M416,104 Q422,108 430,104" className="yd-hall__cap-brim" />
      <path
        d="M442,97 C440,116 441,136 438,156 H445 C446,136 447,116 448,97 Z M447,97 C450,114 452,130 453,146 H459 C457,130 454,112 450,97 Z"
        className="yd-hall__scarf"
      />
      <path d="M438,156 V160 M441,156 V160 M444,156 V160 M453,146 V150 M456,146 V150 M459,146 V150" className="yd-hall__fringe" />
      <path d="M420,176 V146 M452,176 V146" className="yd-hall__handle-bars" />
      <rect x="417" y="142" width="38" height="5" rx="2" className="yd-hall__grip" />
      <path d="M454,147 L460,152" className="yd-hall__tag-string" />
      <rect x="455" y="151" width="9" height="13" rx="1.5" className="yd-hall__tag" />
      <rect x="410" y="176" width="52" height="80" rx="6" fill={url(ids.shell)} />
      <path d="M423,180 V252 M436,180 V252 M449,180 V252" className="yd-hall__ribs" />
      <circle cx="416" cy="258" r="3" className="yd-hall__castor" />
      <circle cx="456" cy="258" r="3" className="yd-hall__castor" />

      <rect x="500" y="62" width="96" height="88" className="yd-hall__poster-frame" />
      <rect x="504" y="66" width="88" height="80" className="yd-hall__poster" />
      <circle cx="548" cy="96" r="22" className="yd-hall__poster-sun" />
      <circle cx="548" cy="96" r="12" className="yd-hall__poster-core" />
      <path d="M512,128 H584 M512,134 H570 M512,140 H578" className="yd-hall__poster-text" />
      <rect x="500" y="62" width="96" height="88" className="yd-hall__poster-shade" />

      <g className="yd-hall__floor-shadows">
        <ellipse cx="190" cy="263" rx="52" ry="3" />
        <ellipse cx="86" cy="263" rx="22" ry="2.5" />
        <ellipse cx="436" cy="262" rx="30" ry="3" />
        <ellipse cx="557" cy="264" rx="74" ry="3.5" />
      </g>
      <circle cx="508" cy="232" r="29" className="yd-hall__tyre" />
      <circle cx="606" cy="232" r="29" className="yd-hall__tyre" />
      <path
        d="M508,205 V259 M481,232 H535 M489,213 L527,251 M527,213 L489,251 M606,205 V259 M579,232 H633 M587,213 L625,251 M625,213 L587,251"
        className="yd-hall__spokes"
      />
      <circle cx="508" cy="232" r="26" className="yd-hall__rim" />
      <circle cx="606" cy="232" r="26" className="yd-hall__rim" />
      <path d="M552,238 L540,182 M540,188 L592,184 M594,192 L552,238 L508,232 L541,190 M596,198 L606,232 M592,180 L596,198" className="yd-hall__bike-frame" />
      <path d="M540,182 L537,172" className="yd-hall__seatpost" />
      <path d="M526,170 Q537,166 548,170 L546,173 H528 Z" className="yd-hall__saddle" />
      <path d="M593,180 L590,170 Q600,164 606,172" className="yd-hall__handlebar" />
      <circle cx="552" cy="238" r="9" className="yd-hall__chainring" />
      <path d="M552,229 L508,228 M552,247 L508,236" className="yd-hall__chain" />
      <path d="M552,238 L560,252" className="yd-hall__crank" />
      <rect x="556" y="251" width="9" height="3" rx="1" className="yd-hall__pedal" />
    </g>
  );
}
