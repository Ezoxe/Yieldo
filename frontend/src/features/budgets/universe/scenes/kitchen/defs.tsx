import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface KitchenIds extends LensDefIds {
  wall: string;
  steel: string;
  wood: string;
  window: string;
  under: string;
  tiles: string;
  floor: string;
}

export function kitchenIds(prefix: string): KitchenIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wall: id("wall"),
    steel: id("steel"),
    wood: id("wood"),
    window: id("window"),
    under: id("under"),
    tiles: id("tiles"),
    floor: id("floor"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in KitchenScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-kitchen__${family}-${index}`} />
      ))}
    </>
  );
}

export function KitchenDefs({ ids }: { ids: KitchenIds }) {
  return (
    <defs>
      <linearGradient id={ids.wall} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wall" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.steel} x1="0" y1="0" x2="1" y2="0">
        <Stops family="steel" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <linearGradient id={ids.wood} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wood" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.window} x1="0" y1="0" x2="0" y2="1">
        <Stops family="window" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.under}>
        <Stops family="under" offsets={[0, 1]} />
      </radialGradient>
      <pattern id={ids.tiles} width="14" height="10" patternUnits="userSpaceOnUse">
        <rect width="14" height="10" className="yd-kitchen__tile" />
        <path d="M0,9.5 H14 M13.5,0 V10" className="yd-kitchen__tile-joint" />
      </pattern>
      <pattern id={ids.floor} width="40" height="20" patternUnits="userSpaceOnUse">
        <rect width="40" height="20" className="yd-kitchen__floor-tile" />
        <path d="M0,19.5 H40 M20,0 V20" className="yd-kitchen__floor-joint" />
      </pattern>
      <LensDefs ids={ids} />
    </defs>
  );
}
