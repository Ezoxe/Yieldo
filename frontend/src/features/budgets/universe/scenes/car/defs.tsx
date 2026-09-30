import { BODY_PATH, TANK } from "./geometry";

/**
 * The ids a scene's gradients, clips and filters are filed under. Prefixed
 * per instance (`useId`), so two scenes on one page — a test rendering two,
 * say — never paint each other's gradients.
 */
export interface SceneIds {
  bodyClip: string;
  tankClip: string;
  blur1: string;
  blur3: string;
  blur6: string;
  paint: string;
  volume: string;
  rearGlass: string;
  doorGlass: string;
  windshield: string;
  carbon: string;
  tire: string;
  disc: string;
  rimShade: string;
  lamp: string;
  handle: string;
  road: string;
  steel: string;
  studio: string;
  fuel: string;
  engine: string;
  vignette: string;
  lines: string;
  lens: (name: string) => string;
}

export function sceneIds(prefix: string): SceneIds {
  const id = (name: string) => `${prefix}-${name}`;
  return {
    bodyClip: id("body"),
    tankClip: id("tank"),
    blur1: id("blur1"),
    blur3: id("blur3"),
    blur6: id("blur6"),
    paint: id("paint"),
    volume: id("volume"),
    rearGlass: id("rear-glass"),
    doorGlass: id("door-glass"),
    windshield: id("windshield"),
    carbon: id("carbon"),
    tire: id("tire"),
    disc: id("disc"),
    rimShade: id("rim-shade"),
    lamp: id("lamp"),
    handle: id("handle"),
    road: id("road"),
    steel: id("steel"),
    studio: id("studio"),
    fuel: id("fuel"),
    engine: id("engine"),
    vignette: id("vignette"),
    lines: id("lines"),
    lens: (name: string) => id(`lens-${name}`),
  };
}

/** Stops carry a class and no colour: every colour lives in CarScene.css. */
function Stops({ family, offsets }: { family: string; offsets: readonly number[] }) {
  return (
    <>
      {offsets.map((offset, index) => (
        <stop key={offset} offset={offset} className={`yd-car__${family}-${index}`} />
      ))}
    </>
  );
}

export const PAINT_OFFSETS = [0, 0.05, 0.25, 0.42, 0.55, 0.7, 0.84, 0.875, 0.9, 0.91, 0.95, 1] as const;

export function SceneDefs({ ids }: { ids: SceneIds }) {
  return (
    <defs>
      <clipPath id={ids.bodyClip}>
        <path d={BODY_PATH} />
      </clipPath>
      <clipPath id={ids.tankClip}>
        <path d={TANK.path} />
      </clipPath>
      <filter id={ids.blur1} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="1.2" />
      </filter>
      <filter id={ids.blur3} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      <filter id={ids.blur6} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <linearGradient id={ids.paint} gradientUnits="userSpaceOnUse" x1="0" y1="80" x2="0" y2="200">
        <Stops family="paint" offsets={PAINT_OFFSETS} />
      </linearGradient>
      <linearGradient id={ids.volume} gradientUnits="userSpaceOnUse" x1="150" y1="0" x2="608" y2="0">
        <Stops family="volume" offsets={[0, 0.06, 0.18, 0.8, 0.93, 1]} />
      </linearGradient>
      <linearGradient id={ids.rearGlass} x1="0" y1="0" x2="0" y2="1">
        <Stops family="rear-glass" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.doorGlass} x1="0" y1="0" x2="0" y2="1">
        <Stops family="door-glass" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <linearGradient id={ids.windshield} gradientUnits="userSpaceOnUse" x1="400" y1="88" x2="455" y2="122">
        <Stops family="windshield" offsets={[0, 0.55, 1]} />
      </linearGradient>
      <linearGradient id={ids.carbon} x1="0" y1="0" x2="0" y2="1">
        <Stops family="carbon" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.tire}>
        <Stops family="tire" offsets={[0.78, 0.88, 0.97, 1]} />
      </radialGradient>
      <radialGradient id={ids.disc}>
        <Stops family="disc" offsets={[0, 0.7, 1]} />
      </radialGradient>
      <linearGradient id={ids.rimShade} x1="0" y1="0" x2="0" y2="1">
        <Stops family="rim-shade" offsets={[0.45, 1]} />
      </linearGradient>
      <linearGradient id={ids.lamp} x1="0" y1="0" x2="1" y2="1">
        <Stops family="lamp" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.handle} x1="0" y1="0" x2="0" y2="1">
        <Stops family="handle" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.road} x1="0" y1="0" x2="0" y2="1">
        <Stops family="road" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.steel} x1="0" y1="0" x2="1" y2="0">
        <Stops family="steel" offsets={[0, 1]} />
      </linearGradient>
      <radialGradient id={ids.studio}>
        <Stops family="studio" offsets={[0, 1]} />
      </radialGradient>
      <linearGradient id={ids.fuel} x1="0" y1="0" x2="0" y2="1">
        <Stops family="fuel" offsets={[0, 1]} />
      </linearGradient>
      <linearGradient id={ids.engine} x1="0" y1="0" x2="0" y2="1">
        <Stops family="engine" offsets={[0, 0.5, 1]} />
      </linearGradient>
      <radialGradient id={ids.vignette}>
        <Stops family="vignette" offsets={[0.55, 1]} />
      </radialGradient>
      <pattern id={ids.lines} width="4" height="3" patternUnits="userSpaceOnUse">
        <path d="M0,.5 H4" className="yd-lens__scanline" />
      </pattern>
    </defs>
  );
}
