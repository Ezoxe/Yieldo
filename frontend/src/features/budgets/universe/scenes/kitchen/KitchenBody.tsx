import type { KitchenIds } from "./defs";

const url = (id: string) => `url(#${id})`;

/**
 * The kitchen: wall and tiled splashback, floor, the window (night in the
 * dark theme, day in the light one — `KitchenScene.css`), upper cabinets lit
 * from below, the steel fridge, the counter with its oven, the delivery box,
 * the espresso machine, and the laid table. Decoration only.
 */
export function KitchenBody({ ids }: { ids: KitchenIds }) {
  return (
    <g className="yd-kitchen__room">
      <rect x="0" y="0" width="640" height="262" fill={url(ids.wall)} />
      <rect x="150" y="112" width="330" height="90" fill={url(ids.tiles)} className="yd-kitchen__splash" />
      <rect x="150" y="112" width="330" height="90" className="yd-kitchen__splash-shade" />
      <rect x="0" y="262" width="640" height="100" fill={url(ids.floor)} />
      <rect x="0" y="262" width="640" height="100" className="yd-kitchen__floor-shade" />

      <rect x="494" y="58" width="112" height="104" rx="2" fill={url(ids.window)} />
      <g className="yd-kitchen__night-sky">
        <circle cx="512" cy="72" r=".9" />
        <circle cx="590" cy="88" r=".8" />
        <circle cx="530" cy="140" r=".7" />
        <circle cx="582" cy="76" r="7" className="yd-kitchen__moon" />
      </g>
      <path d="M550,58 V162 M494,110 H606" className="yd-kitchen__window-bars" />
      <rect x="490" y="54" width="120" height="112" rx="3" className="yd-kitchen__window-frame" />
      <rect x="486" y="164" width="128" height="6" rx="1" className="yd-kitchen__sill" />
      <path d="M500,164 C498,150 506,140 514,142 C512,150 516,158 512,164 Z" className="yd-kitchen__herb" />
      <rect x="500" y="160" width="16" height="6" rx="1" className="yd-kitchen__pot" />

      <rect x="156" y="30" width="318" height="78" rx="2" fill={url(ids.wood)} />
      <path d="M235,30 V108 M314,30 V108 M393,30 V108" className="yd-kitchen__wood-lines" />
      <path d="M228,68 V78 M242,68 V78 M386,68 V78 M400,68 V78" className="yd-kitchen__handles" />
      <ellipse cx="315" cy="118" rx="150" ry="16" fill={url(ids.under)} className="yd-kitchen__under-light" />
      <path d="M156,108 H474" className="yd-kitchen__cabinet-edge" />

      <rect x="36" y="64" width="108" height="198" rx="6" fill={url(ids.steel)} />
      <path d="M36,138 H144" className="yd-kitchen__fridge-split" />
      <path d="M130,82 V122 M130,152 V210" className="yd-kitchen__fridge-handles" />
      <rect x="36" y="64" width="108" height="198" rx="6" className="yd-kitchen__fridge-shade" />

      <rect x="150" y="202" width="330" height="60" fill={url(ids.wood)} />
      <rect x="146" y="196" width="338" height="8" rx="1.5" className="yd-kitchen__worktop" />
      <path d="M232,204 V262 M314,204 V262 M396,204 V262" className="yd-kitchen__wood-lines" />
      <path d="M224,226 V236 M240,226 V236 M388,226 V236 M404,226 V236" className="yd-kitchen__handles" />
      <rect x="280" y="130" width="70" height="48" rx="3" className="yd-kitchen__oven" />
      <rect x="284" y="134" width="62" height="36" rx="2" className="yd-kitchen__oven-glass" />
      <path d="M270,196 H360" className="yd-kitchen__hob" />
      <circle cx="296" cy="186" r="8" className="yd-kitchen__pan" />
      <circle cx="330" cy="186" r="8" className="yd-kitchen__pan" />

      <rect x="202" y="182" width="48" height="12" rx="1.5" className="yd-kitchen__box" />
      <path d="M202,182 L226,176 L250,182" className="yd-kitchen__box-lid" />
      <circle cx="222" cy="176" r="3" className="yd-kitchen__steam" />
      <circle cx="232" cy="176" r="3" className="yd-kitchen__steam" style={{ animationDelay: "1.2s" }} />
      <rect x="364" y="150" width="38" height="46" rx="4" fill={url(ids.steel)} />
      <rect x="368" y="154" width="30" height="10" rx="2" className="yd-kitchen__machine-panel" />
      <rect x="378" y="176" width="10" height="4" rx="1" className="yd-kitchen__spout" />
      <rect x="378" y="186" width="10" height="9" rx="2" className="yd-kitchen__cup" />

      <rect x="440" y="276" width="190" height="10" rx="2" fill={url(ids.wood)} />
      <path d="M452,286 V330 M618,286 V330" className="yd-kitchen__table-legs" />
      <ellipse cx="530" cy="274" rx="20" ry="4" className="yd-kitchen__plate" />
      <ellipse cx="530" cy="273" rx="13" ry="2.5" className="yd-kitchen__dish" />
      <path d="M506,270 V278 M554,270 V278" className="yd-kitchen__cutlery" />
      <path d="M590,262 L594,272 L586,272 Z M590,272 V276" className="yd-kitchen__glass" />
      <circle cx="530" cy="266" r="3" className="yd-kitchen__steam" />
      <circle cx="536" cy="266" r="3" className="yd-kitchen__steam" style={{ animationDelay: "1s" }} />
      <path d="M470,286 C470,258 476,246 486,246 L494,246 L494,300 L470,300 Z" className="yd-kitchen__chair" />
      <path d="M620,300 L620,246 L628,246 C636,246 640,258 640,286" className="yd-kitchen__chair" />
    </g>
  );
}
