import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GlassCard } from "./GlassCard";

describe("GlassCard", () => {
  it("renders its children", () => {
    render(<GlassCard>Patrimoine</GlassCard>);
    expect(screen.getByText("Patrimoine")).toBeInTheDocument();
  });

  it("uses a blurred surface by default", () => {
    const { container } = render(<GlassCard>x</GlassCard>);
    expect(container.firstChild).toHaveClass("yd-glass");
    expect(container.firstChild).not.toHaveClass("yd-glass--solid");
  });

  it("drops the blur for data surfaces", () => {
    const { container } = render(<GlassCard tone="solid">x</GlassCard>);
    expect(container.firstChild).toHaveClass("yd-glass--solid");
  });

  it("only mounts the sheen when interactive", () => {
    const { container: plain } = render(<GlassCard>x</GlassCard>);
    expect(plain.querySelector(".yd-sheen")).toBeNull();
    const { container: interactive } = render(<GlassCard interactive>x</GlassCard>);
    expect(interactive.querySelector(".yd-sheen")).not.toBeNull();
  });

  it("renders as the requested element for correct semantics", () => {
    render(<GlassCard as="section" aria-label="Résumé">x</GlassCard>);
    expect(screen.getByRole("region", { name: "Résumé" })).toBeInTheDocument();
  });

  it("keeps caller classes", () => {
    const { container } = render(<GlassCard className="p-6">x</GlassCard>);
    expect(container.firstChild).toHaveClass("p-6");
  });
});
