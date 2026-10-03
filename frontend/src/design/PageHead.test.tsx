import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/**
 * On a phone the lead is cut at two lines. « Lire la suite » appears only when
 * the cut actually hides something — measured, since jsdom lays nothing out,
 * through the two heights the browser would report.
 */
describe("PageHead on a phone", () => {
  function heights(scroll: number, client: number) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => scroll,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => client,
    });
  }

  afterEach(() => {
    heights(0, 0);
  });

  it("offers « Lire la suite » when two lines hide the rest, and « Réduire » once open", async () => {
    narrow(true);
    heights(120, 44);
    const user = userEvent.setup();
    render(
      <PageHead icon={OverviewIcon} title="Budgets">
        <p>Ce que chaque catégorie a consommé de son enveloppe ce mois-ci, et ce qu'il en reste.</p>
      </PageHead>,
    );

    const more = screen.getByRole("button", { name: "Lire la suite" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(screen.getByRole("button", { name: "Réduire" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("promises nothing when the lead already fits", () => {
    narrow(true);
    heights(40, 44);
    render(
      <PageHead icon={OverviewIcon} title="Avenir">
        <p>Votre argent, jour après jour.</p>
      </PageHead>,
    );
    expect(screen.queryByRole("button", { name: "Lire la suite" })).not.toBeInTheDocument();
  });

  it("never cuts the lead on a wide screen", () => {
    narrow(false);
    heights(120, 44);
    render(
      <PageHead icon={OverviewIcon} title="Budgets">
        <p>Un long texte.</p>
      </PageHead>,
    );
    expect(screen.queryByRole("button", { name: "Lire la suite" })).not.toBeInTheDocument();
  });
});
