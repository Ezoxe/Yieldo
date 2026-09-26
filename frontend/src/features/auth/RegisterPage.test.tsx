import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterPage } from "./RegisterPage";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

describe("RegisterPage", () => {
  it("says registration is closed instead of offering a form that will be refused", async () => {
    fetchMock.mockResolvedValue(json({ open: false, first_account: false }));
    renderPage();

    expect(
      await screen.findByText(
        "Les inscriptions sont fermées : demandez à l'administrateur de cette installation de les ouvrir.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Mot de passe")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute(
      "href",
      "/connexion",
    );
  });

  it("shows the form when registration is open", async () => {
    fetchMock.mockResolvedValue(json({ open: true, first_account: true }));
    renderPage();

    expect(await screen.findByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("shows the form when the status cannot be read: the server still decides", async () => {
    fetchMock.mockRejectedValue(new TypeError("réseau"));
    renderPage();

    expect(await screen.findByLabelText("Mot de passe")).toBeInTheDocument();
  });
});
