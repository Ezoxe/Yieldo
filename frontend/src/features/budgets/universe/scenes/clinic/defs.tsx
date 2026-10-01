import { LensDefs, type LensDefIds } from "../shared/LensFrame";

export interface ClinicIds extends LensDefIds {
  wall: string;
  enamel: string;
  wood: string;
  window: string;
  leather: string;
  lamp: string;
  green: string;
  floor: string;
  blind: string;
}

export function clinicIds(prefix: string): ClinicIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    wall: id("wall"),
    enamel: id("enamel"),
    wood: id("wood"),
    window: id("window"),
    leather: id("leather"),
    lamp: id("lamp"),
    green: id("green"),
    floor: id("floor"),
    blind: id("blind"),
    lines: id("lines"),
    vignette: id("vignette"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in ClinicScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-clinic__${family}-${index}`} />
      ))}
    </>
  );
}

export function ClinicDefs({ ids }: { ids: ClinicIds }) {
  return (
    <defs>
      <linearGradient id={ids.wall} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wall" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.enamel} x1="0" y1="0" x2="1" y2="0">
        <Stops family="enamel" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <linearGradient id={ids.wood} x1="0" y1="0" x2="0" y2="1">
        <Stops family="wood" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.window} x1="0" y1="0" x2="0" y2="1">
        <Stops family="window" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.leather} x1="0" y1="0" x2="0" y2="1">
        <Stops family="leather" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.lamp}>
        <Stops family="lamp" offsets={[0, 1]} />
      </radialGradient>
      <radialGradient id={ids.green}>
        <Stops family="green" offsets={[0, 1]} />
      </radialGradient>
      <pattern id={ids.floor} width="48" height="24" patternUnits="userSpaceOnUse">
        <rect width="48" height="24" className="yd-clinic__floor-tile" />
        <path d="M0,23.5 H48 M47.5,0 V24" className="yd-clinic__floor-joint" />
      </pattern>
      <pattern id={ids.blind} width="8" height="4" patternUnits="userSpaceOnUse">
        <rect width="8" height="4" className="yd-clinic__slat" />
        <path d="M0,3.5 H8" className="yd-clinic__slat-edge" />
      </pattern>
      <LensDefs ids={ids} />
    </defs>
  );
}
