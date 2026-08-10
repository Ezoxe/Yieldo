import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  readStoredDensity,
  storeDensity,
  type DensityPreference,
} from "../design/theme";

interface DensityContextValue {
  density: DensityPreference;
  setDensity: (next: DensityPreference) => void;
}

const DensityContext = createContext<DensityContextValue | null>(null);

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<DensityPreference>(readStoredDensity);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const setDensity = useCallback((next: DensityPreference) => {
    setDensityState(next);
    storeDensity(next);
  }, []);

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityContextValue {
  const context = useContext(DensityContext);
  if (!context) throw new Error("useDensity doit être utilisé dans un DensityProvider");
  return context;
}
