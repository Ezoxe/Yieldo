import type { SceneIds } from "./defs";
import {
  BODY_PATH,
  DOOR_WINDOW_PATH,
  FRONT_DOOR_EDGE,
  REAR_DOOR_EDGE,
  REAR_QUARTER_PATH,
  WINDSHIELD_PATH,
} from "./geometry";

const url = (id: string) => `url(#${id})`;

/**
 * What stands behind the car: the studio light, a toll gantry going past,
 * the road, the beam of the headlight, the shadows and the dark wheel wells.
 * Decoration only — none of it carries a figure.
 */
export function CarBackdrop({ ids }: { ids: SceneIds }) {
  return (
    <g className="yd-car__backdrop">
      <ellipse cx="380" cy="150" rx="300" ry="100" fill={url(ids.studio)} />
      <g className="yd-car__gantry">
        <rect x="612" y="96" width="7" height="118" fill={url(ids.steel)} />
        <rect x="600" y="84" width="32" height="13" rx="2.5" className="yd-car__gantry-head" />
        <circle cx="608" cy="90.5" r="2.3" className="yd-car__gantry-lamp" />
        <circle cx="622" cy="90.5" r="2.3" className="yd-car__gantry-lamp" />
      </g>
      <rect x="0" y="214" width="640" height="24" fill={url(ids.road)} />
      <line x1="0" y1="214.5" x2="640" y2="214.5" className="yd-car__road-edge" />
      <line x1="0" y1="227" x2="640" y2="227" className="yd-car__road-dash" />
      <path d="M575,148 L640,137 L640,174 L575,153 Z" className="yd-car__beam" />
      <ellipse cx="380" cy="214.5" rx="238" ry="6.5" className="yd-car__shadow" filter={url(ids.blur3)} />
      <ellipse cx="251.7" cy="213.8" rx="30" ry="2.4" className="yd-car__contact" />
      <ellipse cx="509.2" cy="213.8" rx="29" ry="2.4" className="yd-car__contact" />
      <path d="M217.56,199.7 A41,41 0 1 1 285.84,199.7 Z" className="yd-car__well" />
      <path d="M474.17,199.7 A41,41 0 1 1 544.23,199.7 Z" className="yd-car__well" />
    </g>
  );
}

/**
 * The body: paint, soft shading, the black parts, the glass, the mirror, the
 * lights and the wing. Static; the wheels and the lenses are drawn over it.
 */
export function CarBody({ ids }: { ids: SceneIds }) {
  return (
    <g className="yd-car__body">
      <path d={BODY_PATH} fill={url(ids.paint)} className="yd-car__outline" />
      <g clipPath={url(ids.bodyClip)}>
        <rect x="148" y="78" width="462" height="124" fill={url(ids.volume)} />
        <ellipse cx="178" cy="160" rx="26" ry="34" className="yd-car__shade yd-car__shade--haunch" filter={url(ids.blur6)} />
        <ellipse cx="240" cy="131" rx="72" ry="8" className="yd-car__shade yd-car__shade--shoulder" filter={url(ids.blur3)} />
        <circle cx="251.7" cy="177" r="45" className="yd-car__arch-shade" filter={url(ids.blur3)} />
        <circle cx="509.2" cy="178.4" r="45" className="yd-car__arch-shade" filter={url(ids.blur3)} />
        <rect x="290" y="150" width="180" height="12" className="yd-car__door-band" filter={url(ids.blur3)} />
        <ellipse cx="588" cy="166" rx="24" ry="26" className="yd-car__shade yd-car__shade--nose" filter={url(ids.blur6)} />
        <path d="M254,121 L445,123" className="yd-car__belt-shade" filter={url(ids.blur1)} />
        <path d="M221,107.5 C240,101.8 262,95.5 284,90.6" className="yd-car__rear-glass-edge" />
      </g>

      <path d="M289.2,193.5 L471,193.5 L474.17,199.7 L285.84,199.7 Z" className="yd-car__black" />
      <path
        d="M150.5,171 C165,172 190,175 213,181.5 L214,199.7 L167,199.7 C158,199 152,194 151.6,186.6 Z"
        className="yd-car__black"
      />
      <path d="M150.8,171.2 C165,172.2 190,175.2 213,181.7" className="yd-car__black-edge" />
      <path
        d="M548.5,193 L600.5,192.5 C604,192.4 607.6,193.2 607.6,195 C607.6,198.5 605,199.7 600,199.7 L548.5,199.7 Z"
        className="yd-car__black"
      />
      <path
        d="M552,166.5 L559.5,165 C561.5,172 563.5,183 564.5,192.5 L556,192.5 C555,183 553.8,173 552,166.5 Z"
        className="yd-car__black"
      />
      <path
        d="M587,168.5 L603.5,166.8 C605,171 605.8,176 605.5,178.4 L601.5,178.6 L600,188 L587,190.5 Z"
        className="yd-car__intake"
      />
      <path d="M588,173 H603 M588,178 H601 M588,183 H600.5 M588,188 H600" className="yd-car__slats" />

      <path d={`${REAR_DOOR_EDGE} ${FRONT_DOOR_EDGE}`} className="yd-car__shut-line" />
      <path
        d="M324.8,138.5 Q324.8,137 326,137 L348.8,137 Q350,137 350,138.5 L350,140 Q350,141.5 348.8,141.5 L326,141.5 Q324.8,141.5 324.8,140 Z"
        fill={url(ids.handle)}
        className="yd-car__handle"
      />
      <path d="M326,142.2 H349" className="yd-car__handle-shade" />
      <ellipse cx="476.1" cy="132.5" rx="10.7" ry="5.7" className="yd-car__flap" />
      <path d="M466.5,134.5 C470,137.6 482,137.8 485.8,134.4" className="yd-car__flap-shade" />
      <path d="M470,122.6 C500,123.4 525,126.6 543,129.8" className="yd-car__crest" />

      <path d={REAR_QUARTER_PATH} fill={url(ids.rearGlass)} className="yd-car__glass" />
      <path d="M291.9,102.1 L321.4,115.3" className="yd-car__cage-hint" />
      <path d="M327.1,90.3 L332.9,89.4 L332.9,119.4 L327.1,118.5 Z" className="yd-car__pillar" />
      <path d={DOOR_WINDOW_PATH} fill={url(ids.doorGlass)} className="yd-car__glass" />
      <path d="M334.5,97.5 L338.8,97.2 L338.8,119.3 L334.5,119.3 Z" className="yd-car__hoop-hint" />
      <path d={WINDSHIELD_PATH} fill={url(ids.windshield)} />
      <path d="M410,96 L420,100.5 L446,121.5 L438,121.7 Z" className="yd-car__reflection" />
      <path d="M300,94.8 L312,92.9 L292,117.6 L282,117.3 Z" className="yd-car__sky yd-car__sky--faint" />
      <path d="M360,88.8 L372,89.2 L352,120.4 L340,120.3 Z" className="yd-car__sky" />

      <path d="M419,123.5 L424,122.5 L428.5,130.5 L421.5,131 Z" className="yd-car__mirror-base" />
      <path
        d="M401.5,114 C402,110.5 408,109.2 416,109.6 C423.5,110 429.5,112.5 430,116.5 C430.3,120 426,123.2 418,123.4 C410,123.6 403,121.5 401.8,118 Z"
        className="yd-car__mirror"
      />
      <path d="M403.5,112 C408,110.3 418,110 426,112.2" className="yd-car__mirror-gleam" />
      <path d="M404,120.3 C410,122.3 421,122.6 427.5,120.4" className="yd-car__mirror-lip" />

      <ellipse cx="558.1" cy="138.8" rx="19.3" ry="5.4" transform="rotate(38 558.1 138.8)" className="yd-car__lamp-bezel" />
      <ellipse cx="558.1" cy="138.8" rx="16.5" ry="3.6" transform="rotate(38 558.1 138.8)" fill={url(ids.lamp)} />
      <g className="yd-car__drl">
        <circle cx="553.5" cy="135.2" r=".9" />
        <circle cx="562.7" cy="142.4" r=".9" />
        <circle cx="549" cy="131.7" r=".9" />
        <circle cx="567.2" cy="145.9" r=".9" />
      </g>
      <path d="M539.5,151.2 L558.5,153.4" className="yd-car__marker-edge" />
      <path d="M539.5,151.2 L558.5,153.4" className="yd-car__marker" />

      <path
        d="M158.5,130.4 L206,133.4 L205.5,137.8 L159.2,139.4 C158.3,136.5 158.2,133 158.5,130.4 Z"
        className="yd-car__tail-band"
      />
      <path d="M160.5,132.3 L194,133.8 L194,135.4 L160.7,134.2 Z" className="yd-car__tail-light" />
      <path d="M158.8,129.5 L205,132.4" className="yd-car__tail-gleam" />
      <path
        d="M153.8,151.5 L177.5,152.5 C178.5,152.6 178.5,156.8 177.5,157 L154.5,157.4 Z"
        className="yd-car__reflector"
      />
      <path d="M160.8,126 C170,125.3 180,124.5 188,124" className="yd-car__lip-shade" />

      <path
        d="M195.5,95.2 C206,93.6 212.5,95.5 214.8,100.5 L218.8,109.8 L212.6,111 L208.8,103 C207.3,99.8 203,98.8 195.5,99.2 Z"
        className="yd-car__wing-neck"
      />
      <path d="M197,95.6 C206,94.4 211.5,96 213.6,100.2" className="yd-car__wing-gleam" />
      <path
        d="M162.5,97.8 L199.5,94.8 Q205.8,94.4 206.2,99.2 L205.2,108.3 Q204.7,111.7 200.5,111.9 L166.2,112.6 Q161.8,112.6 161.8,108.6 Z"
        fill={url(ids.carbon)}
        className="yd-car__wing"
      />
      <path d="M164.5,101.5 C177,97.2 191,96.4 204.8,98.6" className="yd-car__wing-profile" />
    </g>
  );
}
