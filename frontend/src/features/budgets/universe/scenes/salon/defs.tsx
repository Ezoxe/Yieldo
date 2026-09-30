import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface SalonIds extends LensDefIds {
  wall: string;
  screen: string;
  window: string;
  wood: string;
  sofa: string;
  lamp: string;
  tvLight: string;
  parquet: string;
  paper: string;
}

export function salonIds(prefix: string): SalonIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wall: id("wall"),
    screen: id("screen"),
    window: id("window"),
    wood: id("wood"),
    sofa: id("sofa"),
    lamp: id("lamp"),
    tvLight: id("tv-light"),
    parquet: id("parquet"),
    paper: id("paper"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in SalonScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-salon__${family}-${index}`} />
      ))}
    </>
  );
}

export function SalonDefs({ ids }: { ids: SalonIds }) {
  return (
    <defs>
      <linearGradient id={ids.wall} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wall" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.screen} x1="0" y1="0" x2="0" y2="1">
        <Stops family="screen" offsets={[0, 0.55, 0.62, 1]} />
      </linearGradient>
      <linearGradient id={ids.window} x1="0" y1="0" x2="0" y2="1">
        <Stops family="window" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.wood} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wood" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.sofa} x1="0" y1="0" x2="0" y2="1">
        <Stops family="sofa" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.lamp}>
        <Stops family="lamp" offsets={[0, 1]} />
      </radialGradient>
      <radialGradient id={ids.tvLight}>
        <Stops family="tv-light" offsets={[0, 1]} />
      </radialGradient>
      <pattern id={ids.parquet} width="48" height="12" patternUnits="userSpaceOnUse">
        <rect width="48" height="12" className="yd-salon__plank" />
        <path d="M0,11.5 H48 M24,0 V12" className="yd-salon__plank-joint" />
        <path d="M4,4 H18 M30,7 H44" className="yd-salon__plank-grain" />
      </pattern>
      <pattern id={ids.paper} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" className="yd-salon__paper" />
        <path d="M4,0 V8" className="yd-salon__paper-stripe" />
      </pattern>
      <LensDefs ids={ids} />
    </defs>
  );
}
