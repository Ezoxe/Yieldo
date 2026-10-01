import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface BankIds extends LensDefIds {
  wall: string;
  steel: string;
  fascia: string;
  cool: string;
  warm: string;
  floor: string;
}

export function bankIds(prefix: string): BankIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wall: id("wall"),
    steel: id("steel"),
    fascia: id("fascia"),
    cool: id("cool"),
    warm: id("warm"),
    floor: id("floor"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in BankScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-bank__${family}-${index}`} />
      ))}
    </>
  );
}

export function BankDefs({ ids }: { ids: BankIds }) {
  return (
    <defs>
      <linearGradient id={ids.wall} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wall" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.steel} x1="0" y1="0" x2="1" y2="1">
        <Stops family="steel" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <linearGradient id={ids.fascia} x1="0" y1="0" x2="1" y2="0">
        <Stops family="fascia" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <radialGradient id={ids.cool}>
        <Stops family="cool" offsets={[0, 1]} />
      </radialGradient>
      <radialGradient id={ids.warm}>
        <Stops family="warm" offsets={[0, 1]} />
      </radialGradient>
      <pattern id={ids.floor} width="32" height="32" patternUnits="userSpaceOnUse">
        <rect width="32" height="32" className="yd-bank__tile-dark" />
        <rect width="16" height="16" className="yd-bank__tile-light" />
        <rect x="16" y="16" width="16" height="16" className="yd-bank__tile-light" />
      </pattern>
      <LensDefs ids={ids} />
    </defs>
  );
}
