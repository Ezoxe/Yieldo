import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadSwap } from "./LoadSwap";
import { useMotionPreference } from "./motionPreference";

const skeleton = <p role="status">Squelette</p>;
const content = <p>Contenu</p>;

afterEach(() => {
  useMotionPreference.setState({ disabled: false });
});

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./LoadSwap.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("LoadSwap", () => {
  it("puts the skeleton in the document at once, announced as a wait", () => {
    render(<LoadSwap loading skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.getByRole("status")).toHaveTextContent("Squelette");
    expect(screen.queryByText("Contenu")).not.toBeInTheDocument();
  });

  // A local server answers in 40ms: a skeleton SEEN for that long is a flash
  // between the screen and itself. It only becomes visible after 150ms.
  it("keeps the skeleton invisible for its first 150ms", () => {
    render(<LoadSwap loading skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.getByRole("status").parentElement).toHaveClass("yd-load-swap__wait");
    expect(css).toMatch(/\.yd-load-swap__wait\s*\{\s*animation:\s*yd-load-swap-appear 160ms var\(--yd-ease\) 150ms both/);
  });

  it("hands over to the content when the data lands", () => {
    const { rerender } = render(<LoadSwap loading skeleton={skeleton}>{content}</LoadSwap>);
    rerender(<LoadSwap loading={false} skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });

  it("swaps outright with motion off", () => {
    useMotionPreference.setState({ disabled: true });
    const { rerender } = render(<LoadSwap loading skeleton={skeleton}>{content}</LoadSwap>);
    rerender(<LoadSwap loading={false} skeleton={skeleton}>{content}</LoadSwap>);
    expect(screen.queryByText("Squelette")).not.toBeInTheDocument();
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });
});
