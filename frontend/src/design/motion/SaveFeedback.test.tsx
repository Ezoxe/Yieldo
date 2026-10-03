import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SaveLabel } from "./SaveFeedback";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SaveLabel", () => {
  it("says what the button does, then what it is doing", () => {
    const { rerender } = render(
      <SaveLabel saved={false} saving={false} label="Enregistrer le profil" />,
    );
    expect(screen.getByText("Enregistrer le profil")).toBeInTheDocument();
    rerender(<SaveLabel saved={false} saving label="Enregistrer le profil" />);
    expect(screen.getByText("Enregistrement…")).toBeInTheDocument();
  });

  // The confirmation is in the control the reader just pressed, where their
  // eyes are — for 1.4s, then the button is a button again.
  it("says « Enregistré » with a drawn check right after a save, then goes back", () => {
    const { rerender, container } = render(
      <SaveLabel saved={false} saving label="Enregistrer le profil" />,
    );
    rerender(<SaveLabel saved saving={false} label="Enregistrer le profil" />);
    expect(screen.getByText("Enregistré")).toBeInTheDocument();
    expect(container.querySelector(".yd-save-check")).not.toBeNull();

    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByText("Enregistrer le profil")).toBeInTheDocument();
  });

  it("confirms every save of a form that only counts them", () => {
    const { rerender } = render(<SaveLabel saved={0} saving={false} label="Enregistrer le seuil" />);
    expect(screen.getByText("Enregistrer le seuil")).toBeInTheDocument();
    rerender(<SaveLabel saved={1} saving={false} label="Enregistrer le seuil" />);
    expect(screen.getByText("Enregistré")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1500));
    rerender(<SaveLabel saved={2} saving={false} label="Enregistrer le seuil" />);
    expect(screen.getByText("Enregistré")).toBeInTheDocument();
  });

  it("puts the check in place of the button's own icon", () => {
    const icon = <svg data-testid="own-icon" />;
    const { rerender } = render(
      <SaveLabel saved={false} saving={false} label="Enregistrer" icon={icon} />,
    );
    expect(screen.getByTestId("own-icon")).toBeInTheDocument();
    rerender(<SaveLabel saved saving={false} label="Enregistrer" icon={icon} />);
    expect(screen.queryByTestId("own-icon")).toBeNull();
  });
});
