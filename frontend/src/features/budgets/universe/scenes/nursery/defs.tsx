import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface NurseryIds extends LensDefIds {
  wallpaper: string;
  floor: string;
  window: string;
  warm: string;
  moonlight: string;
}

export function nurseryIds(prefix: string): NurseryIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wallpaper: id("wallpaper"),
    floor: id("floor"),
    window: id("window"),
    warm: id("warm"),
    moonlight: id("moonlight"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in NurseryScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-nursery__${family}-${index}`} />
      ))}
    </>
  );
}

export function NurseryDefs({ ids }: { ids: NurseryIds }) {
  return (
    <defs>
      <pattern id={ids.wallpaper} width="28" height="24" patternUnits="userSpaceOnUse">
        <rect width="28" height="24" className="yd-nursery__paper" />
        <path
          d="M7,5 l1,2 l2,.4 l-1.6,1.4 l.4,2 l-1.8,-1 l-1.8,1 l.4,-2 l-1.6,-1.4 l2,-.4 Z"
          className="yd-nursery__paper-star"
        />
        <circle cx="21" cy="17" r="1.2" className="yd-nursery__paper-star" />
      </pattern>
      <pattern id={ids.floor} width="54" height="14" patternUnits="userSpaceOnUse">
        <rect width="54" height="14" className="yd-nursery__plank" />
        <path d="M0,13.5 H54 M26.5,0 V14" className="yd-nursery__plank-joint" />
      </pattern>
      <linearGradient id={ids.window} x1="0" y1="0" x2="0" y2="1">
        <Stops family="window" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.warm}>
        <Stops family="warm" offsets={[0, 1]} />
      </radialGradient>
      <radialGradient id={ids.moonlight}>
        <Stops family="moonlight" offsets={[0, 1]} />
      </radialGradient>
      <LensDefs ids={ids} />
    </defs>
  );
}
