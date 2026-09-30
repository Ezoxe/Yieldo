import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface HouseIds extends LensDefIds {
  sky: string;
  lawn: string;
  roofShade: string;
  wallShade: string;
  glass: string;
  door: string;
  garage: string;
  lamp: string;
  moonGlow: string;
  sunGlow: string;
  tiles: string;
  render: string;
  brick: string;
}

export function houseIds(prefix: string): HouseIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    sky: id("sky"),
    lawn: id("lawn"),
    roofShade: id("roof-shade"),
    wallShade: id("wall-shade"),
    glass: id("glass"),
    door: id("door"),
    garage: id("garage"),
    lamp: id("lamp"),
    moonGlow: id("moon-glow"),
    sunGlow: id("sun-glow"),
    tiles: id("tiles"),
    render: id("render"),
    brick: id("brick"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in HouseScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-house__${family}-${index}`} />
      ))}
    </>
  );
}

export function HouseDefs({ ids }: { ids: HouseIds }) {
  return (
    <defs>
      <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
        <Stops family="sky" offsets={[0, 0.55, 0.85, 1]} />
      </linearGradient>
      <linearGradient id={ids.lawn} x1="0" y1="0" x2="0" y2="1">
        <Stops family="lawn" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.roofShade} x1="0" y1="0" x2="0" y2="1">
        <Stops family="roof-shade" offsets={[0, 0.6, 1]} />
      </linearGradient>
      <linearGradient id={ids.wallShade} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wall-shade" offsets={[0, 0.22, 1]} />
      </linearGradient>
      <linearGradient id={ids.glass} x1="0" y1="0" x2="0" y2="1">
        <Stops family="glass" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.door} x1="0" y1="0" x2="1" y2="0">
        <Stops family="door" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <linearGradient id={ids.garage} x1="0" y1="0" x2="0" y2="1">
        <Stops family="garage" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.lamp}>
        <Stops family="lamp" offsets={[0, 1]} />
      </radialGradient>
      <radialGradient id={ids.moonGlow}>
        <Stops family="moon-glow" offsets={[0.6, 1]} />
      </radialGradient>
      <radialGradient id={ids.sunGlow}>
        <Stops family="sun-glow" offsets={[0.4, 1]} />
      </radialGradient>
      <pattern id={ids.tiles} width="10" height="7" patternUnits="userSpaceOnUse">
        <rect width="10" height="7" className="yd-house__tile" />
        <path d="M0,.5 Q2.5,3.6 5,.5 Q7.5,3.6 10,.5" className="yd-house__tile-curve" />
        <path d="M0,6.6 H10" className="yd-house__tile-joint" />
      </pattern>
      <pattern id={ids.render} width="7" height="7" patternUnits="userSpaceOnUse">
        <rect width="7" height="7" className="yd-house__render" />
        <circle cx="1.5" cy="2" r=".55" className="yd-house__render-dot" />
        <circle cx="5" cy="5.2" r=".45" className="yd-house__render-light" />
        <circle cx="4.2" cy="1.2" r=".35" className="yd-house__render-dot" />
      </pattern>
      <pattern id={ids.brick} width="10" height="5" patternUnits="userSpaceOnUse">
        <rect width="10" height="5" className="yd-house__brick" />
        <path d="M0,4.6 H10 M3,0 V2.3 M8,2.3 V4.6 M0,2.3 H10" className="yd-house__mortar" />
      </pattern>
      <LensDefs ids={ids} />
    </defs>
  );
}
