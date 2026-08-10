import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { DensityProvider } from "../../app/DensityProvider";
import { ThemeProvider } from "../../app/ThemeProvider";
import { useMotionPreference } from "../../design/motion/motionPreference";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { SettingsPage } from "./SettingsPage";

// A plain consumer of the same hook every other component in the app uses —
// proves the "Animations" switch actually reaches useReducedMotion(), not
// just some local SettingsPage state.
function ReducedMotionProbe() {
  const reduced = useReducedMotion();
  return <span data-testid="reduced-motion-probe">{String(reduced)}</span>;
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <DensityProvider>
          <SettingsPage />
          <ReducedMotionProbe />
        </DensityProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  useMotionPreference.setState({ disabled: false });
});

describe("SettingsPage", () => {
  it("labels every control", () => {
    renderSettings();
    expect(screen.getByLabelText("Thème")).toBeInTheDocument();
    expect(screen.getByLabelText("Densité d'affichage")).toBeInTheDocument();
    expect(screen.getByLabelText("Activer les animations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
  });

  it("updates data-theme on the document element when the theme changes", async () => {
    const user = userEvent.setup();
    renderSettings();

    // jsdom has no window.matchMedia, so ThemeProvider's "system" default
    // resolves to "dark" (see ThemeProvider.tsx's `?? true` fallback) —
    // switching to "light" is therefore a real, observable transition.
    await user.selectOptions(screen.getByLabelText("Thème"), "light");

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("updates data-density on the document element when the density changes", async () => {
    const user = userEvent.setup();
    renderSettings();

    // DensityProvider defaults to "comfortable" — switching to "compact" is
    // the real, observable transition this test checks.
    expect(document.documentElement.dataset.density).toBe("comfortable");
    await user.selectOptions(screen.getByLabelText("Densité d'affichage"), "compact");

    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("makes useReducedMotion() return true once the animation switch is turned off", async () => {
    const user = userEvent.setup();
    renderSettings();

    expect(screen.getByTestId("reduced-motion-probe")).toHaveTextContent("false");

    await user.click(screen.getByLabelText("Activer les animations"));

    expect(screen.getByTestId("reduced-motion-probe")).toHaveTextContent("true");
  });
});
