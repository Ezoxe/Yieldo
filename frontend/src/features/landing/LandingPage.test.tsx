import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatCents } from "../../design/theme";
import { LandingPage } from "./LandingPage";

function mockReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // Motion still calls the deprecated pair when a motion.* element mounts.
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockReducedMotion(true);
});

describe("LandingPage structure", () => {
  it("leads with one h1 saying what Yieldo is", () => {
    renderLanding();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/Vos dépenses au clair/);
  });

  it("follows the operations-landing section order", () => {
    const { container } = renderLanding();
    const titles = [...container.querySelectorAll("h2")].map((heading) => heading.textContent);
    expect(titles).toEqual([
      "Ce qui est en place aujourd'hui",
      "Et c'est exactement le sujet",
      "Quatre étapes, une seule fois",
      "Prêt à regarder vos comptes ?",
    ]);
  });

  it("paints itself on the shared atmosphere layer, not a background of its own", () => {
    const { container } = renderLanding();
    expect(container.querySelector('[data-testid="yd-atmosphere"]')).not.toBeNull();
  });
});

describe("LandingPage calls to action", () => {
  // Registration can be closed server-side (YIELDO_REGISTRATION_OPEN), so the
  // login path must never be reachable only by way of the signup one.
  it("offers signing in as its own top-level link, everywhere it offers signing up", () => {
    renderLanding();
    const signIn = screen.getAllByRole("link", { name: "Se connecter" });
    const signUp = screen.getAllByRole("link", { name: "Créer un compte" });
    expect(signIn.length).toBe(signUp.length);
    expect(signIn.length).toBeGreaterThanOrEqual(3);
    for (const link of signIn) expect(link).toHaveAttribute("href", "/connexion");
    for (const link of signUp) expect(link).toHaveAttribute("href", "/inscription");
  });

  // The pattern puts a primary CTA in the page's own bar.
  it("carries both in the page's top bar", () => {
    const { container } = renderLanding();
    const bar = container.querySelector(".yd-landing__bar") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(within(bar).getByRole("link", { name: "Créer un compte" })).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Se connecter" })).toBeInTheDocument();
  });

  it("says out loud that registration may be closed on this instance", () => {
    renderLanding();
    expect(screen.getByText(/inscriptions ont été fermées/i)).toBeInTheDocument();
  });
});

describe("LandingPage honesty", () => {
  it("states each of the four boundaries plainly", () => {
    renderLanding();
    expect(screen.getByText(/n'est pas un agrégateur bancaire/i)).toBeInTheDocument();
    expect(screen.getByText(/identifiants bancaires ne sont jamais demandés/i)).toBeInTheDocument();
    expect(screen.getByText(/Aucune donnée ne quitte la machine/i)).toBeInTheDocument();
    expect(screen.getByText(/fichier que vous avez exporté vous-même/i)).toBeInTheDocument();
  });

  // The one thing a landing page can do that a screenshot review cannot catch:
  // promise a phase-2 feature as if it shipped. Every one of these words may
  // appear on the page only inside the cell that marks it as unavailable.
  it.each(["budget", "récurrent", "patrimoine", "clés API"])(
    "mentions %s only in the 'pas encore disponible' cell",
    (term) => {
      const { container } = renderLanding();
      const pending = container.querySelector(".yd-landing__cell--pending") as HTMLElement;
      expect(pending).not.toBeNull();
      expect(pending.textContent?.toLowerCase()).toContain(term.toLowerCase());

      const rest = (container.textContent ?? "")
        .toLowerCase()
        .replace((pending.textContent ?? "").toLowerCase(), "");
      expect(rest).not.toContain(term.toLowerCase());
    },
  );

  // MASTER.md forbids emoji as icons. Ranges cover pictographs, dingbats,
  // transport/map symbols and the emoji variation selector.
  it("uses no emoji anywhere in its text", () => {
    const { container } = renderLanding();
    expect(container.textContent ?? "").not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u,
    );
  });

  it("draws its icons as inline SVG", () => {
    const { container } = renderLanding();
    const icons = container.querySelectorAll("svg.yd-icon");
    expect(icons.length).toBe(10);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe("LandingPage product preview", () => {
  it("is captioned as an example with invented figures, in French", () => {
    renderLanding();
    const caption = screen.getByText(/Exemple — données fictives/);
    expect(caption).toBeInTheDocument();
    expect(caption.tagName).toBe("FIGCAPTION");
  });

  // aria-hidden would hide the disclaimer from exactly the readers who cannot
  // see that the numbers are a mock-up.
  it("is not hidden from assistive technology", () => {
    const { container } = renderLanding();
    const figure = container.querySelector(".yd-preview-figure") as HTMLElement;
    expect(figure).not.toBeNull();
    expect(figure.closest("[aria-hidden='true']")).toBeNull();
  });

  it("formats its fabricated amounts from integer cents", () => {
    const { container } = renderLanding();
    // Read straight off the attribute: Testing Library's label queries collapse
    // the non-breaking spaces formatCents deliberately emits, so a normalised
    // match would pass on a figure formatted with plain spaces too.
    const labels = [...container.querySelectorAll(".yd-preview__stat [role='status']")].map(
      (element) => element.getAttribute("aria-label"),
    );
    // 246 000 cents of income and 198 740 of spending leave a net of 47 260 at
    // a savings rate of 19,2 % — arithmetic the preview has to satisfy, not
    // four independently plausible strings.
    expect(labels).toEqual([
      formatCents(246_000),
      formatCents(-198_740),
      formatCents(47_260, { signed: true }),
      "19,2 %",
    ]);
  });

  it("shows the whole month's spending, split across its categories", () => {
    const { container } = renderLanding();
    const rows = [...container.querySelectorAll(".yd-preview__category")];
    expect(rows.length).toBeGreaterThanOrEqual(5);
    // Every amount reads as an outflow, with the typographic minus formatCents
    // uses — never a bare figure that could be mistaken for income.
    for (const row of rows) {
      expect(row.querySelector(".yd-preview__category-value")?.textContent).toMatch(/^−/);
    }
  });
});
