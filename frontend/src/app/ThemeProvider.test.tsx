import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMotionPreference } from "../design/motion/motionPreference";
import { ThemeProvider, useTheme } from "./ThemeProvider";

type StartViewTransition = (update: () => void) => {
  ready: Promise<void>;
  finished: Promise<void>;
};

function Switch() {
  const { resolved, setPreference } = useTheme();
  return (
    <button type="button" onClick={() => setPreference("light", { x: 40, y: 20 })}>
      {resolved}
    </button>
  );
}

// Loosely typed on purpose: the test installs and removes the method, which
// lib.dom declares as always there.
const doc = document as unknown as { startViewTransition?: StartViewTransition };

beforeEach(() => {
  localStorage.setItem("yieldo.theme", "dark");
  document.documentElement.dataset.theme = "dark";
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  delete doc.startViewTransition;
  delete (document.documentElement as Partial<HTMLElement>).animate;
  useMotionPreference.setState({ disabled: false });
  localStorage.clear();
});

describe("ThemeProvider", () => {
  it("changes the theme at once where the browser has no view transitions", async () => {
    render(
      <ThemeProvider>
        <Switch />
      </ThemeProvider>,
    );
    await act(async () => screen.getByRole("button").click());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button")).toHaveTextContent("light");
  });

  // The new theme opens in a circle from where it was asked for: the page is
  // pictured once in the old colours and the new one is revealed over it.
  it("reveals the new theme in a circle from the click point", async () => {
    const animate = vi.fn();
    document.documentElement.animate = animate as unknown as HTMLElement["animate"];
    let themeInside: string | undefined;
    let markInside: string | undefined;
    doc.startViewTransition = vi.fn((update: () => void) => {
      update();
      themeInside = document.documentElement.dataset.theme;
      markInside = document.documentElement.dataset.vt;
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    });

    render(
      <ThemeProvider>
        <Switch />
      </ThemeProvider>,
    );
    await act(async () => screen.getByRole("button").click());

    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    expect(themeInside).toBe("light");
    expect(markInside).toBe("theme");
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as [
      { clipPath: string[] },
      { pseudoElement: string },
    ];
    expect(keyframes.clipPath[0]).toBe("circle(0px at 40px 20px)");
    expect(options.pseudoElement).toBe("::view-transition-new(root)");
    // Over: the mark that froze the page into one picture is gone.
    expect(document.documentElement.dataset.vt).toBeUndefined();
  });

  it("changes the theme at once under the motion switch", async () => {
    useMotionPreference.setState({ disabled: true });
    doc.startViewTransition = vi.fn();
    render(
      <ThemeProvider>
        <Switch />
      </ThemeProvider>,
    );
    await act(async () => screen.getByRole("button").click());
    expect(doc.startViewTransition).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
