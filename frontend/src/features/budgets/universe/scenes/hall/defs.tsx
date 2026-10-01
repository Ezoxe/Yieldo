import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface HallIds extends LensDefIds {
  wall: string;
  door: string;
  window: string;
  shell: string;
  wood: string;
  warm: string;
  parquet: string;
}

export function hallIds(prefix: string): HallIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wall: id("wall"),
    door: id("door"),
    window: id("window"),
    shell: id("shell"),
    wood: id("wood"),
    warm: id("warm"),
    parquet: id("parquet"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in HallScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-hall__${family}-${index}`} />
      ))}
    </>
  );
}

export function HallDefs({ ids }: { ids: HallIds }) {
  return (
    <defs>
      <linearGradient id={ids.wall} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wall" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.door} x1="0" y1="0" x2="1" y2="0">
        <Stops family="door" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <linearGradient id={ids.window} x1="0" y1="0" x2="0" y2="1">
        <Stops family="window" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.shell} x1="0" y1="0" x2="1" y2="0">
        <Stops family="shell" offsets={[0, 0.45, 1]} />
      </linearGradient>
      <linearGradient id={ids.wood} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wood" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.warm}>
        <Stops family="warm" offsets={[0, 1]} />
      </radialGradient>
      <pattern id={ids.parquet} width="64" height="24" patternUnits="userSpaceOnUse">
        <rect width="64" height="24" className="yd-hall__plank" />
        <path d="M0,11.5 H64 M0,23.5 H64 M31.5,0 V12 M63.5,12 V24" className="yd-hall__plank-joint" />
      </pattern>
      <LensDefs ids={ids} />
    </defs>
  );
}
