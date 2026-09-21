import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { EnvironmentSwitcher } from "./EnvironmentSwitcher";
import { environmentFor } from "./navigation";

function Here() {
  return <span data-testid="here">{useLocation().pathname}</span>;
}

function renderSwitcher(entry = "/transactions") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SwitcherAt />
              <Here />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function SwitcherAt() {
  return <EnvironmentSwitcher current={environmentFor(useLocation().pathname)} />;
}

describe("EnvironmentSwitcher", () => {
  it("names the product first and the environment under it", () => {
    renderSwitcher("/transactions");
    const button = screen.getByRole("button", { name: /Yieldo/ });
    expect(button).toHaveTextContent("Yieldo");
    expect(button).toHaveTextContent("Finances");
  });

  it("stays closed until it is asked", () => {
    renderSwitcher();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yieldo/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("offers both halves, each with the line that says what it is for", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("button", { name: /Yieldo/ }));

    const menu = within(screen.getByRole("menu"));
    const items = menu.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Finances"),
      expect.stringContaining("Investissement"),
    ]);
    expect(items[1]).toHaveTextContent("Le pilotage");
  });

  it("marks the current half with aria-checked, not with colour alone", async () => {
    const user = userEvent.setup();
    renderSwitcher("/invest/mandat");
    await user.click(screen.getByRole("button", { name: /Yieldo/ }));

    const items = within(screen.getByRole("menu")).getAllByRole("menuitemradio");
    expect(items[0]).toHaveAttribute("aria-checked", "false");
    expect(items[1]).toHaveAttribute("aria-checked", "true");
  });

  it("lands on the chosen half's home", async () => {
    const user = userEvent.setup();
    renderSwitcher("/transactions");
    await user.click(screen.getByRole("button", { name: /Yieldo/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Investissement/ }));

    expect(screen.getByTestId("here")).toHaveTextContent("/invest");
    expect(screen.getByRole("button", { name: /Yieldo/ })).toHaveTextContent("Investissement");
  });

  it("takes a reader deep in one half back to its home", async () => {
    const user = userEvent.setup();
    renderSwitcher("/invest/supervision");
    await user.click(screen.getByRole("button", { name: /Yieldo/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Investissement/ }));
    expect(screen.getByTestId("here")).toHaveTextContent("/invest");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("button", { name: /Yieldo/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
