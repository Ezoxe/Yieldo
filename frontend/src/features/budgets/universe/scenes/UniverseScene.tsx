import type { ComponentType } from "react";

import type { UniverseId } from "../registry";
import type { Gauge, PartReading } from "../readings";
import { CarScene } from "./car/CarScene";

/** What every scene is handed: the page's ceiling, the parts, and the way to a part's page. */
export interface SceneProps {
  gauge: Gauge | null;
  /** What the dial measures, in words: « Budget Transport ». */
  gaugeTitle: string;
  parts: PartReading[];
  onSelect: (categoryId: number) => void;
}

const SCENES: Record<UniverseId, ComponentType<SceneProps>> = {
  car: CarScene,
};

/** The scene of `universe`: one component per universe, all on the same props. */
export function UniverseScene({ universe, ...props }: SceneProps & { universe: UniverseId }) {
  const Scene = SCENES[universe];
  return <Scene {...props} />;
}
