import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { BottomTabs } from "./BottomTabs";

function renderTabs(entry = "/budgets", onMore = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <BottomTabs onMore={onMore} moreOpen={false} />
    </MemoryRouter>,
  );
  return onMore;
}

describe("BottomTabs", () => {
  it("offers the four everyday screens and « Plus », each with a word", () => {
    renderTabs();
    const nav = screen.getByRole("navigation", { name: "Navigation rapide" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Accueil", "Transactions", "Budgets", "Assistant",
    ]);
    // The tab's visible word is short; its accessible name is the sidebar's.
    expect(links[0]).toHaveAccessibleName("Vue d'ensemble");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/", "/transactions", "/budgets", "/assistant",
    ]);
    expect(within(nav).getByRole("button", { name: "Plus" })).toBeInTheDocument();
  });

  it("marks the screen the reader is on", () => {
    renderTabs("/budgets");
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Transactions" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark the dashboard on every route that starts with /", () => {
    renderTabs("/transactions");
    expect(screen.getByRole("link", { name: "Vue d'ensemble" })).not.toHaveAttribute("aria-current");
  });

  it("hands « Plus » to the drawer, and says whether it is open", async () => {
    const user = userEvent.setup();
    const onMore = renderTabs();
    const more = screen.getByRole("button", { name: "Plus" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute("aria-controls", "yd-sidebar-drawer");
    await user.click(more);
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  // The bar exists for the reader who has no sidebar. On a desktop it is
  // simply absent, and the shell's main area is not padded for it.
  it("shows only where the sidebar is hidden", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.resolve(here, "./BottomTabs.css"), "utf8");
    const base = css.match(/\.yd-tabs\s*\{([^}]*)\}/);
    expect(base?.[1]).toMatch(/display:\s*none/);
    expect(css).toMatch(/@media \(max-width: 899px\)/);
  });
});
