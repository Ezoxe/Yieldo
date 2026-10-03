import { useEffect, useState, type ReactNode } from "react";

import { CheckIcon } from "../icons";
import "./drawn.css";
import "./SaveFeedback.css";

/** How long the button says « Enregistré » before it is a button again. */
const SAVED_MS = 1400;

interface SaveLabelProps {
  /**
   * True once the save succeeded (the form's own `saved` state, reset when
   * the next submission starts), or a count of successful saves for a form
   * that keeps no such state. Each change to a truthy value is one « Enregistré ».
   */
  saved: boolean | number;
  saving: boolean;
  /** What the button does: « Enregistrer le profil ». */
  label: string;
  /** The button's own icon, which the check replaces while it is shown. */
  icon?: ReactNode;
  savingLabel?: string;
  savedLabel?: string;
}

/**
 * A submit button's words, and the confirmation that it worked IN the button.
 *
 * The form's own status line (« Profil enregistré. », `role="status"`) is
 * still there for assistive technology and stays; this is for the eye, which
 * is on the button it just pressed: for 1.4s it says « Enregistré » beside a
 * check that draws itself (SaveFeedback.css), then it is a button again.
 */
export function SaveLabel({
  saved,
  saving,
  label,
  icon = null,
  savingLabel = "Enregistrement…",
  savedLabel = "Enregistré",
}: SaveLabelProps) {
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    setJustSaved(true);
    const timer = window.setTimeout(() => setJustSaved(false), SAVED_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  if (saving) {
    return (
      <>
        {icon}
        {savingLabel}
      </>
    );
  }
  if (justSaved) {
    return (
      <span className="yd-save-done">
        <CheckIcon className="yd-save-check yd-drawn" />
        {savedLabel}
      </span>
    );
  }
  return (
    <>
      {icon}
      {label}
    </>
  );
}
