import { useEffect, useState } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * A layout decision belongs in CSS whenever CSS can make it. This hook is for
 * the cases where it cannot: a control that is not the same control on a phone
 * as on a desktop — different markup, different semantics — rather than the
 * same markup laid out differently. Rendering both and hiding one with a media
 * query would put two controls with the same accessible name in the document,
 * which is worse than either.
 *
 * Returns false when `matchMedia` is unavailable (test environments, SSR): the
 * desktop rendering is the one that degrades safely, since it is the one that
 * shows every option at once.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const update = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
