import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Drawer } from "./Drawer";
import { RecurrencesIcon } from "./icons";

function phone(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: matches && query.includes("max-width: 639px"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => phone(false));

describe("Drawer", () => {
  it("slides in from the right on a wide screen", () => {
    phone(false);
    render(
      <Drawer open onClose={vi.fn()} title="Loyer" subtitle="Chaque mois" icon={RecurrencesIcon}>
        <p>Le détail.</p>
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog", { name: "Loyer" });
    expect(dialog).toHaveClass("yd-drawer__panel");
    expect(screen.getByText("Chaque mois")).toBeInTheDocument();
  });

  // A 440px panel from the right covers a phone edge to edge and leaves its
  // close button in the top corner, out of thumb reach: on a phone the same
  // content rises from the bottom instead.
  it("rises from the bottom as a sheet on a phone, with the same head and body", () => {
    phone(true);
    render(
      <Drawer open onClose={vi.fn()} title="Loyer" subtitle="Chaque mois" icon={RecurrencesIcon}>
        <p>Le détail.</p>
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog", { name: "Loyer" });
    expect(dialog).toHaveClass("yd-sheet__panel");
    expect(screen.getByText("Chaque mois")).toBeInTheDocument();
    expect(screen.getByText("Le détail.")).toBeInTheDocument();
  });
});
