import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OverviewIcon } from "./icons";
import { PageHead } from "./PageHead";

function narrow(matches: boolean) {
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

afterEach(() => {
  narrow(false);
});

describe("PageHead", () => {
  it("shows the full lead when there is room for it", () => {
    narrow(false);
    render(
      <PageHead icon={OverviewIcon} title="Patrimoine" shortLead={<p>Court.</p>}>
        <p>La version longue, celle qui dit tout.</p>
      </PageHead>,
    );

    expect(screen.getByText("La version longue, celle qui dit tout.")).toBeInTheDocument();
    expect(screen.queryByText("Court.")).not.toBeInTheDocument();
  });

  // One node in the document, never two with one hidden: a lead rendered twice
  // is a lead that has to be kept true twice, and the hidden copy is the one
  // nobody re-reads.
  it("swaps in the short lead on a phone, and does not keep both", () => {
    narrow(true);
    render(
      <PageHead icon={OverviewIcon} title="Patrimoine" shortLead={<p>Court.</p>}>
        <p>La version longue, celle qui dit tout.</p>
      </PageHead>,
    );

    expect(screen.getByText("Court.")).toBeInTheDocument();
    expect(screen.queryByText("La version longue, celle qui dit tout.")).not.toBeInTheDocument();
  });

  it("keeps the only lead a screen has when no short one was written", () => {
    narrow(true);
    render(
      <PageHead icon={OverviewIcon} title="Trésorerie">
        <p>Déjà court.</p>
      </PageHead>,
    );

    expect(screen.getByText("Déjà court.")).toBeInTheDocument();
  });

  it("names the screen with its h1 alone — the mark is decoration", () => {
    narrow(false);
    const { container } = render(<PageHead icon={OverviewIcon} title="Patrimoine" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Patrimoine");
    expect(container.querySelector(".yd-page-head__mark")).toHaveAttribute("aria-hidden", "true");
  });
});
