import { useEffect, useState } from "react";

import { useMotionPreference } from "./motionPreference";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  // The Reglages "Animations" switch always wins: it disables motion even
  // when the OS itself has no reduced-motion preference set.
  const disabledByUser = useMotionPreference((state) => state.disabled);

  const [systemReduced, setSystemReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(QUERY);
    const update = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return systemReduced || disabledByUser;
}
