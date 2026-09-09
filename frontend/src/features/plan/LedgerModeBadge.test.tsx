import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { LedgerModeBadge } from "./LedgerModeBadge";
import { useLedgerMode } from "./useLedgerMode";

function renderBadge() {
  return render(
    <MemoryRouter>
      <LedgerModeBadge />
    </MemoryRouter>,
  );
}

describe("LedgerModeBadge", () => {
  beforeEach(() => {
    useLedgerMode.setState({ mode: "real", loaded: true });
  });

  it("says nothing when the figures are simply real", () => {
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing before the server has answered", () => {
    useLedgerMode.setState({ mode: "estimated", loaded: false });
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });

  it("names a qualified reading and leads to the control that set it", () => {
    useLedgerMode.setState({ mode: "estimated", loaded: true });
    renderBadge();

    const badge = screen.getByRole("link", { name: /Mode Estimé/ });
    expect(badge).toHaveAttribute("href", "/reglages");
  });

  it("names the blended reading by its own word", () => {
    useLedgerMode.setState({ mode: "blended", loaded: true });
    renderBadge();

    expect(screen.getByRole("link", { name: /Mode Réel complété/ })).toBeInTheDocument();
  });
});
