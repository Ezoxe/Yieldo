/** A short horizontal shake: 4px, settling, 320ms. */
const SHAKE: Keyframe[] = [
  { translate: "0 0" },
  { translate: "-4px 0" },
  { translate: "4px 0" },
  { translate: "-3px 0" },
  { translate: "2px 0" },
  { translate: "0 0" },
];

function motionIsOff(): boolean {
  if (document.documentElement.dataset.motion === "off") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * After a form is submitted, the fields it marked `aria-invalid` shake once.
 *
 * Installed once, at boot, for every form in the app: the forms keep their
 * own validation and their own messages; this only points the eye at the
 * field to change. It listens to `submit` alone — a field that turns invalid
 * while the reader types is told so by its message, never by a jolt — and
 * looks one frame later, once React has rendered what the handler decided.
 * Errors that come back from the server arrive later than that frame, with
 * their own entry (`[role="alert"]`, controls.css). Motion off: nothing.
 *
 * Returns the function that removes the listener (tests).
 */
export function installInvalidShake(): () => void {
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    requestAnimationFrame(() => {
      if (motionIsOff()) return;
      for (const field of form.querySelectorAll<HTMLElement>('[aria-invalid="true"]')) {
        field.animate?.(SHAKE, { duration: 320, easing: "cubic-bezier(0.25, 1, 0.5, 1)" });
      }
    });
  };
  document.addEventListener("submit", onSubmit, true);
  return () => document.removeEventListener("submit", onSubmit, true);
}
