import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface DressingIds extends LensDefIds {
  wallpaper: string;
  floor: string;
  glass: string;
  warm: string;
}

export function dressingIds(prefix: string): DressingIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wallpaper: id("wallpaper"),
    floor: id("floor"),
    glass: id("glass"),
    warm: id("warm"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in DressingScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-dressing__${family}-${index}`} />
      ))}
    </>
  );
}

export function DressingDefs({ ids }: { ids: DressingIds }) {
  return (
    <defs>
      <pattern id={ids.wallpaper} width="16" height="10" patternUnits="userSpaceOnUse">
        <rect width="16" height="10" className="yd-dressing__paper" />
        <path d="M8.5,0 V10" className="yd-dressing__paper-stripe" />
      </pattern>
      <pattern id={ids.floor} width="56" height="14" patternUnits="userSpaceOnUse">
        <rect width="56" height="14" className="yd-dressing__plank" />
        <path d="M0,13.5 H56 M27.5,0 V14" className="yd-dressing__plank-joint" />
      </pattern>
      <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="1">
        <Stops family="glass" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.warm}>
        <Stops family="warm" offsets={[0, 1]} />
      </radialGradient>
      <LensDefs ids={ids} />
    </defs>
  );
}
