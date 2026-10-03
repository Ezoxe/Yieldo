import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatCents } from "../theme";
import { DeltaPill } from "./DeltaPill";

const euros = (cents: number) => formatCents(cents);

describe("DeltaPill", () => {
  it("names the change since the reader's last look, signed, in its own unit", () => {
    render(<DeltaPill delta={21_225} format={euros} upIsGood />);
    const pill = screen.getByText(/depuis votre dernier passage/);
    expect(pill).toHaveTextContent("+212,25 € depuis votre dernier passage");
    expect(pill).toHaveClass("yd-delta-pill--good");
  });

  // Spending going down is good news: the tone follows the meaning, not the sign.
  it("reads a fall as good news where down is good", () => {
    render(<DeltaPill delta={-5_000} format={euros} upIsGood={false} />);
    const pill = screen.getByText(/depuis votre dernier passage/);
    expect(pill).toHaveTextContent("−50,00 € depuis votre dernier passage");
    expect(pill).toHaveClass("yd-delta-pill--good");
  });

  it("says nothing about a figure that did not move", () => {
    const { container } = render(<DeltaPill delta={0} format={euros} upIsGood />);
    expect(container).toBeEmptyDOMElement();
  });
});
