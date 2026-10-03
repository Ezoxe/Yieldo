import { useEffect, useState } from "react";

/** The phone header's height: a title that slides under it is already gone. */
const HEADER_OFFSET = 56;

/**
 * The screen's own title, while its `h1` is scrolled out above the header.
 *
 * On a phone the header has no room for a permanent title, and the page's own
 * `h1` is the first thing to scroll away — three screens down Budgets, nothing
 * on screen says Budgets. So the header borrows the `h1`'s words for exactly as
 * long as the `h1` itself cannot be seen, the way a phone's native large title
 * folds into its navigation bar.
 *
 * Read from the document rather than passed down: every screen already writes
 * its title once, in `PageHead`, and a second copy handed to the shell would be
 * a second thing to keep true. A screen renders its `h1` when its chunk or its
 * data lands, so the hook keeps looking until one appears.
 */
export function useCompactTitle(pathname: string): string | null {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    setTitle(null);
    if (typeof IntersectionObserver === "undefined") return;

    let observer: IntersectionObserver | null = null;
    let observed: Element | null = null;

    const attach = () => {
      const heading = document.querySelector("main h1");
      if (!heading || heading === observed) return;
      observer?.disconnect();
      observed = heading;
      observer = new IntersectionObserver(
        ([entry]) => {
          // Out of view ABOVE the header — not merely below the fold, which is
          // where a title sits on a screen the reader has not reached yet.
          const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < HEADER_OFFSET;
          setTitle(scrolledPast ? heading.textContent?.trim() || null : null);
        },
        { rootMargin: `-${HEADER_OFFSET}px 0px 0px 0px` },
      );
      observer.observe(heading);
    };

    attach();
    const main = document.querySelector("main");
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(attach);
    if (main) mutations?.observe(main, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      mutations?.disconnect();
    };
  }, [pathname]);

  return title;
}
