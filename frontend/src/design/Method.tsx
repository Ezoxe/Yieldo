import type { ReactNode } from "react";

import "./Method.css";

interface MethodProps {
  /** The fold's own line. « Comment c'est calculé » unless the screen has a better word. */
  summary?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The method behind a figure, folded.
 *
 * Every measurement in Yieldo comes with its reasoning — what was counted,
 * over what window, what would change it — and four screens printed that
 * reasoning as paragraphs under every figure. The figure and its verdict stay
 * in sight; the paragraph moves behind this fold, one click away, where the
 * reader who wants it finds it and the reader who has read it once is not
 * made to read it again.
 *
 * A native `<details>`: keyboard-operable, announced as a disclosure, no
 * script. `InfoTip` is the shorter form of the same idea, for a line; this is
 * for a paragraph or three.
 */
export function Method({ summary = "Comment c'est calculé", children, className = "" }: MethodProps) {
  return (
    <details className={`yd-method${className ? ` ${className}` : ""}`}>
      <summary className="yd-method__summary">{summary}</summary>
      <div className="yd-method__body">{children}</div>
    </details>
  );
}
