import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { MoreSheet } from "./MoreSheet";
import { environmentFor } from "./navigation";

function renderSheet(path = "/budgets", onClose = vi.fn(), badges = {}) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MoreSheet open onClose={onClose} environment={environmentFor(path)} badges={badges} />
    </MemoryRouter>,
  );
  return onClose;
}

describe("MoreSheet", () => {
  it("lays out every destination of the environment, under their headings", () => {
    renderSheet("/budgets");
    const sheet = screen.getByRole("dialog", { name: "Plus" });
    const tiles = within(sheet)
      .getAllByRole("link")
      .filter((link) => link.classList.contains("yd-more__tile"))
      .map((link) => link.getAttribute("href"));
    expect(tiles).toEqual([
      "/", "/transactions", "/budgets", "/recurrences", "/plan", "/avenir", "/analyse",
      "/dettes", "/objectifs", "/suivi", "/alertes",
      "/patrimoine", "/projection", "/faisabilite", "/simulateurs",
      "/assistant", "/propositions", "/export", "/categories", "/import", "/reglages",
    ]);
    expect(within(sheet).getByRole("heading", { name: "Au quotidien" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Budgets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens with the import and the switch between the two environments", () => {
    renderSheet("/budgets");
    expect(screen.getByRole("link", { name: "Importer un relevé" })).toHaveAttribute(
      "href",
      "/import",
    );
    const switcher = within(screen.getByRole("group", { name: "Environnement" }));
    expect(switcher.getByRole("link", { name: "Finances" })).toHaveAttribute("aria-current", "true");
    expect(switcher.getByRole("link", { name: "Investissement" })).toHaveAttribute(
      "href",
      "/invest",
    );
  });

  it("shows the investment destinations, and no statement import, in that environment", () => {
    renderSheet("/invest/mandat");
    expect(screen.getByRole("link", { name: "Mandat" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Importer un relevé" })).not.toBeInTheDocument();
  });

  it("closes itself when a destination is chosen", async () => {
    const user = userEvent.setup();
    const onClose = renderSheet("/budgets");
    await user.click(screen.getByRole("link", { name: "Avenir" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("carries the counts the sidebar carries, in the link's own name", () => {
    renderSheet("/", vi.fn(), { "/alertes": 3 });
    expect(screen.getByRole("link", { name: "Alertes, 3 en cours" })).toBeInTheDocument();
  });
});
