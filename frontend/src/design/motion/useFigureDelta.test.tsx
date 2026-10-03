import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { forgetSessionMemory } from "./sessionMemory";
import { useFigureDelta } from "./useFigureDelta";

function Probe({ id, value }: { id: string; value: number }) {
  const delta = useFigureDelta(id, value);
  return <p data-testid="delta">{delta}</p>;
}

beforeEach(() => forgetSessionMemory());

describe("useFigureDelta", () => {
  it("says nothing the first time a figure is seen", () => {
    render(<Probe id="overview.net:2026-09" value={184_237} />);
    expect(screen.getByTestId("delta")).toHaveTextContent("0");
  });

  // The pill's reference: what THIS figure, for THIS period, showed the last
  // time the reader looked — not what another period showed.
  it("measures the change against the last look at the same figure", () => {
    render(<Probe id="overview.net:2026-09" value={163_012} />).unmount();
    render(<Probe id="overview.net:2026-09" value={184_237} />);
    expect(screen.getByTestId("delta")).toHaveTextContent("21225");
  });

  it("does not compare two periods with each other", () => {
    render(<Probe id="overview.net:2026-08" value={151_870} />).unmount();
    render(<Probe id="overview.net:2026-09" value={184_237} />);
    expect(screen.getByTestId("delta")).toHaveTextContent("0");
  });

  it("takes the new figure's own reference when the period changes in place", () => {
    render(<Probe id="overview.net:2026-08" value={151_870} />).unmount();
    const { rerender } = render(<Probe id="overview.net:2026-09" value={184_237} />);
    rerender(<Probe id="overview.net:2026-08" value={150_000} />);
    expect(screen.getByTestId("delta")).toHaveTextContent("-1870");
  });
});
