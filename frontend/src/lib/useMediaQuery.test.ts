import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "./useMediaQuery";

interface FakeMedia {
  matches: boolean;
  listeners: Array<(event: MediaQueryListEvent) => void>;
}

function install(matches: boolean): FakeMedia {
  const media: FakeMedia = { matches, listeners: [] };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
        media.listeners.push(fn),
      removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
        media.listeners = media.listeners.filter((listener) => listener !== fn);
      },
    }),
  });
  return media;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("reports whether the query matches right now", () => {
    install(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 899px)"));
    expect(result.current).toBe(true);
  });

  it("follows the query when the viewport changes", () => {
    const media = install(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 899px)"));
    expect(result.current).toBe(false);

    act(() => {
      media.matches = true;
      media.listeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it("falls back to the wide rendering when matchMedia is absent", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useMediaQuery("(max-width: 899px)"));
    expect(result.current).toBe(false);
  });
});
