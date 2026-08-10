import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("labels both fields in French", () => {
    renderPage();
    expect(screen.getByLabelText("Adresse email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("shows the backend error message on invalid credentials", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Identifiants invalides" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText("Adresse email"), "max@example.com");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "mauvais");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Identifiants invalides");
  });

  it("disables the button while the request is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    renderPage();
    await userEvent.type(screen.getByLabelText("Adresse email"), "max@example.com");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "motdepasse123");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(screen.getByRole("button", { name: /connexion/i })).toBeDisabled();
    release(
      new Response(JSON.stringify({ access_token: "t", user: { id: 1, name: "Max" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
