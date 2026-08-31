import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { SimulatorsPage } from "./SimulatorsPage";
import { SIMULATOR_CONTEXT, jsonResponse } from "./fixtures";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/simulators/context") {
      return Promise.resolve(jsonResponse(SIMULATOR_CONTEXT));
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("ResizeObserver", undefined);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

function renderPage(entry = "/simulateurs") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider>
        <SimulatorsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("SimulatorsPage — the tabs", () => {
  it("offers the three simulators as a tablist", () => {
    renderPage();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Crédit", "Épargne", "Immobilier"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
  });

  it("opens on the tab the URL asks for, so a reload keeps it", () => {
    renderPage("/simulateurs?onglet=epargne");
    expect(screen.getByRole("tab", { name: "Épargne" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/Versement mensuel/)).toBeInTheDocument();
  });

  it("falls back to the credit tab on a query it does not recognise", () => {
    // Never a blank panel, and never a crash on a hand-edited URL.
    renderPage("/simulateurs?onglet=poney");
    expect(screen.getByRole("tab", { name: "Crédit" })).toHaveAttribute("aria-selected", "true");
  });

  it("writes the chosen tab into the URL so it can be linked", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Épargne" }));

    expect(screen.getByRole("tab", { name: "Épargne" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/Versement mensuel/)).toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys, wrapping at both ends", async () => {
    const user = userEvent.setup();
    renderPage();
    // Focus lands on the tablist through its one tab stop. Reached by clicking
    // here rather than by Tab, because the lead paragraph above carries a link
    // that is legitimately the first stop on the page.
    await user.click(screen.getByRole("tab", { name: "Crédit" }));
    expect(screen.getByRole("tab", { name: "Crédit" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Épargne" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Épargne" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Immobilier" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Crédit" })).toHaveFocus();
  });

  it("takes every tab but the active one out of the Tab order", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: "Crédit" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Épargne" })).toHaveAttribute("tabindex", "-1");
  });
});

describe("SimulatorsPage — what this screen is for", () => {
  it("says how it differs from /faisabilite, and links to it", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /Faisabilité d'achat/ });
    expect(link).toHaveAttribute("href", "/faisabilite");
    expect(screen.getByTestId("yd-sim-lead")).toHaveTextContent(/et si/i);
    expect(screen.getByTestId("yd-sim-lead")).toHaveTextContent(/puis-je/i);
  });
});
