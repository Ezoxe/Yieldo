import { useReducedMotion } from "../motion/useReducedMotion";
import "./AtmosphericBackground.css";

const BLOBS = ["a", "b", "c"] as const;

/**
 * The depth layer every authenticated screen is painted on: a base gradient
 * plus three slowly drifting ambient blobs. Purely decorative, so it is hidden
 * from assistive technology and takes no pointer events.
 *
 * It must be a sibling of the app content, not an ancestor: the content is what
 * gets the positioned stacking context (`position: relative; z-index: 1`).
 */
export function AtmosphericBackground() {
  const reducedMotion = useReducedMotion();

  const classes = ["yd-atmosphere", reducedMotion ? "" : "yd-atmosphere--animated"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} aria-hidden="true" data-testid="yd-atmosphere">
      {BLOBS.map((blob) => (
        <div key={blob} className={`yd-atmosphere__blob yd-atmosphere__blob--${blob}`}>
          <div className="yd-atmosphere__blob-fill" />
        </div>
      ))}
      {/* Last, so it dithers the halos rather than sitting under them. Static:
          animated grain is a texture the eye tracks, which is the opposite of
          what this layer is for. */}
      <div className="yd-atmosphere__grain" />
    </div>
  );
}
