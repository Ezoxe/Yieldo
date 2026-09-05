import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { AppShell } from "./AppShell";
import { ThemeProvider } from "./ThemeProvider";

const NAV_LABEL = "Navigation principale";

function mockReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // Motion's own internal reduced-motion detection still calls the
      // legacy MediaQueryList methods (deprecated in browsers but present
      // alongside addEventListener/removeEventListener), so a mock missing
      // them throws as soon as a motion.* component mounts.
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider>
        <Routes>
          <Route element={<AppShell userName="Maxime" />}>
            <Route index element={<p>Écran vue d'ensemble</p>} />
            <Route path="transactions" element={<p>Écran transactions</p>} />
            <Route path="budgets" element={<p>Écran budgets</p>} />
            <Route path="recurrences" element={<p>Écran récurrences</p>} />
            <Route path="tresorerie" element={<p>Écran trésorerie</p>} />
            <Route path="analyse" element={<p>Écran analyse</p>} />
            <Route path="categories" element={<p>Écran catégories</p>} />
            <Route path="import" element={<p>Écran import</p>} />
            <Route path="reglages" element={<p>Écran réglages</p>} />
          </Route>
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("marks only the active nav link with aria-current", () => {
    renderShell("/transactions");

    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Vue d'ensemble" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the overview link active on the index route without matching other routes", () => {
    renderShell("/");

    expect(screen.getByRole("link", { name: "Vue d'ensemble" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Transactions" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // Pinned as a list, not a count: a nav entry silently dropped in a refactor
  // is a screen the operator can no longer reach, and /budgets is the only
  // place a monthly budget can be set while /categories is a placeholder.
  it("lists every screen in the sidebar, in order", () => {
    renderShell("/");

    expect(
      within(screen.getByRole("navigation", { name: NAV_LABEL }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Vue d'ensemble",
      "Transactions",
      "Budgets",
      "Récurrences",
      // The forecast plan sits with the everyday screens rather than with the
      // horizon ones: it is about the month in hand, not about ten years out.
      "Plan prévisionnel",
      "Trésorerie",
      "Analyse",
      "Dettes",
      "Objectifs",
      "Suivi",
      "Alertes",
      "Patrimoine",
      "Projection",
      "Faisabilité",
      "Simulateurs",
      "Assistant",
      // The queue the agent writes into. Its own entry, because a proposal
      // waiting on a decision must be visible from every screen — the badge
      // beside this label is what makes that true.
      "Propositions",
      "Export IA",
      "Catégories",
      "Import",
      "Réglages",
      // Réglages -> Connexions, the screen every French refusal in
      // `market/client.py` and `llm/client.py` sends the reader to. Its own
      // nav entry, because a link buried inside another screen is not an
      // address a sentence can point at.
      "Connexions",
    ]);
  });

  it("routes the Analyse nav entry to the analysis screen", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await user.click(screen.getByRole("link", { name: "Analyse" }));

    expect(screen.getByRole("main")).toHaveTextContent("Écran analyse");
    expect(screen.getByRole("link", { name: "Analyse" })).toHaveAttribute("aria-current", "page");
  });

  it("routes the Récurrences nav entry to the recurrences screen", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await user.click(screen.getByRole("link", { name: "Récurrences" }));

    expect(screen.getByRole("main")).toHaveTextContent("Écran récurrences");
    expect(screen.getByRole("link", { name: "Récurrences" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("routes the Trésorerie nav entry to the treasury screen", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await user.click(screen.getByRole("link", { name: "Trésorerie" }));

    expect(screen.getByRole("main")).toHaveTextContent("Écran trésorerie");
    expect(screen.getByRole("link", { name: "Trésorerie" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("routes the Budgets nav entry to the budgets screen", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await user.click(screen.getByRole("link", { name: "Budgets" }));

    expect(screen.getByRole("main")).toHaveTextContent("Écran budgets");
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute("aria-current", "page");
  });

  it("renders the routed page content inside main", () => {
    renderShell("/categories");

    expect(screen.getByRole("main")).toHaveTextContent("Écran catégories");
  });

  it("shows the user's name in the header", () => {
    renderShell("/");

    expect(screen.getByText("Maxime")).toBeInTheDocument();
  });

  describe("mobile drawer", () => {
    // The static sidebar (`.yd-shell__sidebar--static`) is always mounted and
    // only hidden by a CSS media query, which jsdom does not apply (no CSS
    // engine here — see vitest.config.ts). So once the drawer opens, its own
    // identically-labeled <nav> makes TWO "Navigation principale" landmarks
    // queryable at once. Every assertion below accounts for that instead of
    // assuming a single nav exists while the drawer is open.

    beforeEach(() => {
      // The drawer's slide-in and the scrim's fade run through Motion in JS
      // (see AppShell.tsx / variants.ts), and jsdom has no real animation
      // clock, so an unmount driven by an exit animation would not be
      // synchronous here. Forcing the reduced-motion branch keeps these
      // assertions deterministic while still exercising real component
      // logic — AppShell renders plain elements (no motion.* wrapper) in
      // that branch, but the same drawerOpen state, handlers, and markup.
      mockReducedMotion(true);
    });

    function getToggle() {
      return screen.getByRole("button", { name: "Menu" });
    }

    function getNavs() {
      return screen.getAllByRole("navigation", { name: NAV_LABEL });
    }

    it("opens from the toggle button and closes again", async () => {
      const user = userEvent.setup();
      renderShell("/");

      expect(getNavs()).toHaveLength(1);

      await user.click(getToggle());
      expect(getNavs()).toHaveLength(2);

      await user.click(getToggle());
      expect(getNavs()).toHaveLength(1);
    });

    it("tracks the open state with aria-expanded on the toggle", async () => {
      const user = userEvent.setup();
      renderShell("/");
      const toggle = getToggle();

      expect(toggle).toHaveAttribute("aria-expanded", "false");

      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on Escape", async () => {
      const user = userEvent.setup();
      renderShell("/");

      await user.click(getToggle());
      expect(getNavs()).toHaveLength(2);

      await user.keyboard("{Escape}");
      expect(getNavs()).toHaveLength(1);
      expect(getToggle()).toHaveAttribute("aria-expanded", "false");
    });

    it("closes when the scrim is clicked", async () => {
      const user = userEvent.setup();
      const { container } = renderShell("/");

      await user.click(getToggle());
      const scrim = container.querySelector(".yd-shell__scrim");
      expect(scrim).not.toBeNull();

      await user.click(scrim as Element);
      expect(getNavs()).toHaveLength(1);
      expect(getToggle()).toHaveAttribute("aria-expanded", "false");
    });

    it("keeps navigation reachable while the drawer is open", async () => {
      const user = userEvent.setup();
      renderShell("/transactions");

      await user.click(getToggle());
      const [, drawerNav] = getNavs();

      // The drawer's own copy of the active link should reflect the route,
      // and clicking it should both navigate and close the drawer (the
      // drawer's onNavigate wires to closeDrawer).
      expect(within(drawerNav).getByRole("link", { name: "Transactions" })).toHaveAttribute(
        "aria-current",
        "page",
      );

      await user.click(within(drawerNav).getByRole("link", { name: "Vue d'ensemble" }));

      expect(screen.getByRole("main")).toHaveTextContent("Écran vue d'ensemble");
      expect(getNavs()).toHaveLength(1);
    });

    it("also opens via the toggle when motion is not reduced", async () => {
      // Mounting is synchronous regardless of the Motion animation applied
      // to it (only the visual transition is deferred), so this exercises
      // the animated branch without waiting on an exit animation.
      mockReducedMotion(false);
      const user = userEvent.setup();
      renderShell("/");

      await user.click(getToggle());
      expect(getNavs()).toHaveLength(2);
    });
  });
});

// jsdom applies no stylesheets, so these read the CSS as text (comments
// stripped, so prose naming a property cannot satisfy an assertion). The shell
// is chrome, not data: it has to let the atmosphere through, and an opaque
// surface here is invisible in a mounted test and obvious on screen.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shellCss = readFileSync(path.resolve(__dirname, "./AppShell.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function ruleBody(selector: string): string {
  const match = new RegExp(`${selector.replace(/[.[\]="']/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(
    shellCss,
  );
  expect(match, `rule not found in AppShell.css: ${selector}`).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

describe("AppShell.css", () => {
  for (const selector of [".yd-shell__sidebar", ".yd-shell__header"]) {
    it(`${selector} is translucent, so the atmosphere survives behind it`, () => {
      const body = ruleBody(selector);
      expect(body).toMatch(/background:\s*var\(--yd-surface\)\s*;/);
      expect(body).toMatch(/backdrop-filter:\s*blur\(var\(--yd-glass-blur\)\)/);
      // --yd-surface-strong is opaque in both themes; it is what hid the layer.
      expect(body).not.toMatch(/--yd-surface-strong/);
    });
  }

  it("the active nav pill does not use the same surface as the sidebar it sits on", () => {
    const sidebar = ruleBody(".yd-shell__sidebar");
    const active = ruleBody('.yd-shell__sidebar a[aria-current="page"]');
    const surfaceOf = (body: string) => /background:\s*var\((--yd-[\w-]+)\)/.exec(body)?.[1];
    expect(surfaceOf(active)).toBeDefined();
    expect(surfaceOf(active)).not.toBe(surfaceOf(sidebar));
  });

  it("the drawer stays legible over the scrim with its own raised surface", () => {
    expect(ruleBody(".yd-shell__sidebar--drawer")).toMatch(
      /background:\s*var\(--yd-surface-raised\)\s*;/,
    );
  });
});
