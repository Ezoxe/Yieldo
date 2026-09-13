import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "../features/auth/session";
import { ThemeProvider } from "./ThemeProvider";
import { UserMenu } from "./UserMenu";

const logout = vi.fn(async () => {});

function renderMenu(name = "Maxime") {
  return render(
    <MemoryRouter initialEntries={["/budgets"]}>
      <ThemeProvider>
        <Routes>
          <Route path="/budgets" element={<UserMenu userName={name} />} />
          <Route path="/reglages" element={<h1>Réglages</h1>} />
          <Route path="/connexion" element={<h1>Connexion</h1>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  logout.mockClear();
  useSession.setState({ logout } as never);
  localStorage.clear();
  document.documentElement.dataset.theme = "dark";
});

describe("UserMenu", () => {
  it("is a button carrying the reader's initial and their whole name", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Maxime — menu du compte" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("M");
  });

  it("opens on click with Réglages, the theme and the exit", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /menu du compte/ }));

    const menu = screen.getByRole("menu", { name: "Menu du compte" });
    expect(within(menu).getByRole("menuitem", { name: "Réglages" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Système" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Clair" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Sombre" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Se déconnecter" })).toBeInTheDocument();
  });

  it("switches the theme from the menu and marks the choice", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /menu du compte/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Clair" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("menuitemradio", { name: "Clair" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Sombre" })).toHaveAttribute("aria-checked", "false");
  });

  it("goes to Réglages and closes", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /menu du compte/ }));
    await user.click(screen.getByRole("menuitem", { name: "Réglages" }));

    expect(await screen.findByRole("heading", { name: "Réglages" })).toBeInTheDocument();
  });

  it("signs out through the session and lands on the sign-in page", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /menu du compte/ }));
    await user.click(screen.getByRole("menuitem", { name: "Se déconnecter" }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to the trigger", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: /menu du compte/ });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /menu du compte/ }));
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
