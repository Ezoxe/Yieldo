import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListSkeleton } from "./ListSkeleton";

describe("ListSkeleton", () => {
  it("is announced once as busy, with the rows hidden from assistive technology", () => {
    render(<ListSkeleton rows={4} label="Chargement des opérations" />);
    const status = screen.getByRole("status", { name: "Chargement des opérations" });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.querySelectorAll(".yd-skeleton")).toHaveLength(4);
    expect(status.querySelectorAll("[aria-hidden='true']")).toHaveLength(4);
  });
});
