import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Method } from "./Method";

describe("Method", () => {
  it("is closed by default and says what it holds", () => {
    render(<Method><p>Médiane sur onze mois.</p></Method>);
    const fold = screen.getByText("Comment c'est calculé").closest("details");
    expect(fold).not.toHaveAttribute("open");
    expect(screen.getByText("Comment c'est calculé").tagName).toBe("SUMMARY");
  });

  it("opens on click and keeps the screen's own text inside", async () => {
    const user = userEvent.setup();
    render(<Method summary="Sur quelle période"><p>Du 1er au 31 août.</p></Method>);
    await user.click(screen.getByText("Sur quelle période"));
    expect(screen.getByText("Sur quelle période").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Du 1er au 31 août.")).toBeInTheDocument();
  });
});
