import { type ElementType, type HTMLAttributes, type MouseEvent, useCallback } from "react";

import "./GlassCard.css";

type Tone = "default" | "raised" | "solid";

interface GlassCardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  tone?: Tone;
  interactive?: boolean;
}

const TONE_CLASS: Record<Tone, string> = {
  default: "",
  raised: "yd-glass--raised",
  solid: "yd-glass--solid",
};

export function GlassCard({
  as: Component = "div",
  tone = "default",
  interactive = false,
  className = "",
  children,
  ...rest
}: GlassCardProps) {
  const trackPointer = useCallback((event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--yd-sheen-x",
      `${((event.clientX - bounds.left) / bounds.width) * 100}%`,
    );
    event.currentTarget.style.setProperty(
      "--yd-sheen-y",
      `${((event.clientY - bounds.top) / bounds.height) * 100}%`,
    );
  }, []);

  const classes = [
    "yd-glass",
    TONE_CLASS[tone],
    interactive ? "yd-glass--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component
      className={classes}
      onMouseMove={interactive ? trackPointer : undefined}
      {...rest}
    >
      {interactive ? <span className="yd-sheen" aria-hidden="true" /> : null}
      {children}
    </Component>
  );
}
