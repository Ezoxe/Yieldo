import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMotionPreference } from "./motion/motionPreference";
import { Sheet } from "./Sheet";

afterEach(() => {
  useMotionPreference.setState({ disabled: false });
});

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <Sheet
        open={open}
        title="Carrefour Market"
        subtitle="24 septembre"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <p>Le détail de l'opération.</p>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("renders nothing while closed", () => {
    render(<Sheet open={false} title="Plus" onClose={vi.fn()}>contenu</Sheet>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a dialog named by its title, with the focus inside it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));

    const dialog = screen.getByRole("dialog", { name: "Carrefour Market" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByText("24 septembre")).toBeInTheDocument();
    expect(screen.getByText("Le détail de l'opération.")).toBeInTheDocument();
  });

  it("closes with Escape and gives the focus back to what opened it", async () => {
    // The motion-off branch unmounts at once; the animated one waits for its
    // exit, which jsdom's missing animation clock would never finish.
    useMotionPreference.setState({ disabled: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Ouvrir" });
    await user.click(opener);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes from its button and from the scrim", async () => {
    useMotionPreference.setState({ disabled: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    await user.click(document.querySelector(".yd-sheet__scrim") as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the page under it from scrolling while open", async () => {
    useMotionPreference.setState({ disabled: true });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });
});
