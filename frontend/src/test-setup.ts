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
