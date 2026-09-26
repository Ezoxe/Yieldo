import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession, type SessionStatus } from "../features/auth/session";
import { settle } from "../testing/settle";
import { HomeRoute } from "./HomeRoute";
import { ThemeProvider } from "./ThemeProvider";

const HERO_TITLE = /Vos dépenses au clair/;
const DASHBOARD_MARKER = "Écran tableau de bord";

function mockMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // Motion still calls the deprecated pair when a motion.* element mounts.
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

/**
 * Mirrors the "/" branch of app/routes.tsx: the gate as the route element, the
 * dashboard as its index child. The child stands in for OverviewPage, which
 * would otherwise pull four analytics requests into this test — what is under
 * test is which face the gate shows, not what the dashboard renders.
 */
function renderHome(status: SessionStatus) {
  useSession.setState({ status, isAuthenticated: status === "authenticated" });
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ThemeProvider>
        <Routes>
          <Route path="/" element={<HomeRoute />}>
            <Route index element={<p>{DASHBOARD_MARKER}</p>} />
          </Route>
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMatchMedia();
});

afterEach(() => {
  // Unmounted first: resetting the session under a mounted gate re-renders it
  // outside any act(), after the test is over.
  cleanup();
  useSession.setState({ status: "idle", isAuthenticated: false, user: null });
});

describe("HomeRoute", () => {
  it("shows the public landing page to an anonymous visitor", async () => {
    renderHome("anonymous");
    expect(screen.getByRole("heading", { level: 1, name: HERO_TITLE })).toBeInTheDocument();
    expect(screen.queryByText(DASHBOARD_MARKER)).not.toBeInTheDocument();
    await settle();
  });

  it("shows the dashboard inside the shell to an authenticated operator", async () => {
    renderHome("authenticated");
    expect(screen.getByText(DASHBOARD_MARKER)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: HERO_TITLE })).not.toBeInTheDocument();
    await settle();
  });

  // The failure this prevents is the visible one: hydrate() resolves after the
  // router mounts, so a gate that decided during "idle" would flash the
  // marketing page at an operator reloading their own dashboard.
  it.each<SessionStatus>(["idle", "loading"])(
    "renders neither face while the session is %s",
    (status) => {
      renderHome(status);
      expect(screen.queryByRole("heading", { level: 1, name: HERO_TITLE })).not.toBeInTheDocument();
      expect(screen.queryByText(DASHBOARD_MARKER)).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Chargement");
    },
  );
});

describe("the landing page never reaches an authenticated screen", () => {
  // A guard against the obvious regression: dropping RequireAuth from "/" must
  // not drop it from anything else. This mounts the gate under a path it does
  // not own, and expects it to render nothing of its own.
  it("only ever renders at /", () => {
    useSession.setState({ status: "anonymous", isAuthenticated: false });
    render(
      <MemoryRouter initialEntries={["/transactions"]}>
        <ThemeProvider>
          <Routes>
            <Route path="/" element={<HomeRoute />}>
              <Route index element={<p>{DASHBOARD_MARKER}</p>} />
            </Route>
            <Route path="/transactions" element={<Outlet />} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("heading", { level: 1, name: HERO_TITLE })).not.toBeInTheDocument();
  });
});
