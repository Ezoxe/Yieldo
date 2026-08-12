import type { Variants } from "motion/react";

/**
 * The phase 1.5 signature easing, and the single source of truth for every
 * JS-driven animation. Its CSS twin is `--yd-ease` in tokens.css; the two
 * carry the same curve so a CSS transition and a Motion animation on the same
 * element cannot drift apart. `variants.test.ts` asserts they match.
 */
export const SIGNATURE_EASE = [0.16, 1, 0.3, 1] as const;

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: SIGNATURE_EASE } },
};

export const staggerChildren: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const slideOver: Variants = {
  hidden: { opacity: 0, x: 28 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.28, ease: SIGNATURE_EASE } },
  exit: { opacity: 0, x: 28, transition: { duration: 0.18 } },
};

/** A bento cell arriving: it rises 18px and fades in. */
export const cardEntry: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.42, ease: SIGNATURE_EASE } },
};

/** The timeline a bento grid runs over its cells. */
export const bentoStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

/** What `staggerProps` / `entryProps` spread onto a `motion.*` element. */
interface EntryMotionProps {
  initial?: string;
  animate?: string;
  variants?: Variants;
}

/**
 * Staggered entry, the shape every screen copies:
 *
 *     const reduced = useReducedMotion();
 *     <BentoGrid as={motion.div} {...staggerProps(reduced)}>
 *       <BentoCell as={motion.div} {...entryProps(reduced)}>…</BentoCell>
 *     </BentoGrid>
 *
 * The container owns the timeline; each item carries `variants` and nothing
 * else, because an item that declares its own `animate` opts out of the
 * parent's stagger and fires immediately on mount.
 *
 * Under reduced motion both return `{}`: the elements render as plain markup
 * in their final state. That is deliberately not a 0ms animation — a variant
 * left in place with a zero duration still risks leaving a cell stuck at
 * `opacity: 0` if the animation never runs.
 */
export function staggerProps(reduced: boolean): EntryMotionProps {
  if (reduced) return {};
  return { initial: "hidden", animate: "visible", variants: bentoStagger };
}

/** The item half of {@link staggerProps}. See its doc comment for the pattern. */
export function entryProps(reduced: boolean): EntryMotionProps {
  if (reduced) return {};
  return { variants: cardEntry };
}
