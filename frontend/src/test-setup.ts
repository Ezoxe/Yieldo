import "@testing-library/jest-dom/vitest";

// jsdom implements no IntersectionObserver, and Motion's `whileInView` calls it
// unconditionally on mount — without this, rendering any scroll-triggered
// section throws "IntersectionObserver is not defined" before a single
// assertion runs.
//
// The stub deliberately never reports an intersection: jsdom has no layout, so
// it has no honest answer to "is this on screen". Elements waiting on
// `whileInView` therefore stay in their `hidden` variant, present in the DOM
// but not animated — which is exactly what a test in jsdom can truthfully
// assert about them. Whether they actually appear is a browser question.
class InertIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "0px";
  readonly thresholds: ReadonlyArray<number> = [0];

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (!("IntersectionObserver" in globalThis)) {
  globalThis.IntersectionObserver = InertIntersectionObserver as unknown as typeof IntersectionObserver;
}

// jsdom implements no `matchMedia` at all -- calling it throws "is not a
// function". `ThemeProvider`, `useReducedMotion` and Framer Motion (mounted
// by nearly every page through `motion.div`) all call it from a `useEffect`,
// and Framer Motion's own check runs through a MODULE-LEVEL singleton
// (`initPrefersReducedMotion`) that only fires once per worker, on whichever
// mount happens to hit it first.
//
// A handful of page tests used to redefine `window.matchMedia` locally with
// `vi.fn()` in their own `beforeEach` -- but `vi.restoreAllMocks()` in
// `afterEach` resets a bare `vi.fn()` back to a no-op that returns
// `undefined`, not to "absent". Under CPU contention, a passive effect from
// that SAME test can still be flushing after the reset has already run,
// calling `window.matchMedia(query).addEventListener(...)` on `undefined` --
// `TypeError: Cannot read properties of undefined (reading 'addEventListener')`
// -- intermittent, and gone on a re-run since the timing window closes.
//
// Defined here, once, as a PLAIN function rather than a `vi.fn()`: nothing in
// vitest's mock lifecycle can ever reset it, so it is always present and
// always returns a real, usable `MediaQueryList`-shaped object for the whole
// life of the file's environment -- closing the race outright rather than
// narrowing its window.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom has no real `<canvas>` support (the `canvas` npm package is not
// installed), so `HTMLCanvasElement.prototype.getContext("2d")` returns
// `null`. ECharts -- mounted by every chart-rendering screen against a REAL
// canvas, never a mock -- asks for a 2D context and, today, only avoids
// calling a method on that `null` because jsdom's layout reports every
// element's `clientWidth`/`clientHeight` as 0 and ECharts skips painting a
// zero-sized canvas. That is a fragile coincidence, not a guarantee: it
// depends on an internal early-exit this suite has never audited, and a
// canvas race that starts hitting `null.someMethod()` would be exactly as
// intermittent as the `matchMedia` one above. A no-op 2D context closes the
// hole outright instead of relying on the coincidence.
//
// A `Proxy` rather than an enumerated method list: zrender's canvas painter
// calls a wide, version-dependent surface of the Canvas2D API, and listing
// it by hand is itself a source of the next silent `null` the day it grows.
// The few members that must return a SHAPE rather than be silently callable
// are special-cased; everything else is a no-op call.
if (typeof HTMLCanvasElement !== "undefined") {
  const contextsByCanvas = new WeakMap<HTMLCanvasElement, unknown>();

  function createNoopCanvasContext(canvas: HTMLCanvasElement): unknown {
    const state: Record<string, unknown> = { canvas };
    return new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (prop === "measureText") return () => ({ width: 0 });
        if (
          prop === "createLinearGradient" ||
          prop === "createRadialGradient" ||
          prop === "createPattern" ||
          prop === "createConicGradient"
        ) {
          return () => ({ addColorStop: () => {} });
        }
        if (prop === "getImageData") {
          return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
        }
        if (prop === "getContextAttributes") return () => ({});
        // Any other Canvas2D member this fake was not asked for by name is a
        // drawing or state call whose return value nothing here checks -- a
        // no-op keeps the painter from ever touching `null`.
        return () => {};
      },
      set(target, prop, value) {
        target[prop as string] = value;
        return true;
      },
    });
  }

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ) {
    if (contextId !== "2d") {
      return originalGetContext.apply(this, [contextId, ...rest] as never);
    }
    if (!contextsByCanvas.has(this)) {
      contextsByCanvas.set(this, createNoopCanvasContext(this));
    }
    return contextsByCanvas.get(this);
  } as typeof HTMLCanvasElement.prototype.getContext;
}
