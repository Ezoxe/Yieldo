import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { AppShell } from "./AppShell";
import { ThemeProvider } from "./ThemeProvider";

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider>
        <Routes>
          <Route element={<AppShell userName="Maxime" />}>
            <Route index element={<p>Écran vue d'ensemble</p>} />
            <Route path="transactions" element={<p>Écran transactions</p>} />
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

  it("renders the routed page content inside main", () => {
    renderShell("/categories");

    expect(screen.getByRole("main")).toHaveTextContent("Écran catégories");
  });

  it("shows the user's name in the header", () => {
    renderShell("/");

    expect(screen.getByText("Maxime")).toBeInTheDocument();
  });
});
