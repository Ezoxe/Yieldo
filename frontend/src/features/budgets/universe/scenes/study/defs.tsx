import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface StudyIds extends LensDefIds {
  wall: string;
  window: string;
  metal: string;
  warm: string;
  floor: string;
}

export function studyIds(prefix: string): StudyIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wall: id("wall"),
    window: id("window"),
    metal: id("metal"),
    warm: id("warm"),
    floor: id("floor"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in StudyScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-study__${family}-${index}`} />
      ))}
    </>
  );
}

export function StudyDefs({ ids }: { ids: StudyIds }) {
  return (
    <defs>
      <linearGradient id={ids.wall} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wall" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.window} x1="0" y1="0" x2="0" y2="1">
        <Stops family="window" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.metal} x1="0" y1="0" x2="1" y2="0">
        <Stops family="metal" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <radialGradient id={ids.warm}>
        <Stops family="warm" offsets={[0, 1]} />
      </radialGradient>
      <pattern id={ids.floor} width="60" height="14" patternUnits="userSpaceOnUse">
        <rect width="60" height="14" className="yd-study__plank" />
        <path d="M0,13.5 H60 M29.5,0 V14" className="yd-study__plank-joint" />
      </pattern>
      <LensDefs ids={ids} />
    </defs>
  );
}
