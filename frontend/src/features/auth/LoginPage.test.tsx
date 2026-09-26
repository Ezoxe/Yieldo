import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// The page asks whether registration is open before offering « Créer un
// compte ». That question is answered here, every other call by `fetchMock`.
let registration = { open: true, first_account: false };

beforeEach(() => {
  fetchMock.mockReset();
  registration = { open: true, first_account: false };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/auth/registration")) {
      return Promise.resolve(json(registration));
    }
    return fetchMock(input, init);
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("offers account creation while registration is open", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "Créer un compte" })).toHaveAttribute(
      "href",
      "/inscription",
    );
  });

  it("offers no account creation once registration is closed", async () => {
    registration = { open: false, first_account: false };
    renderPage();
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Créer un compte" })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/Les inscriptions sont fermées/)).toBeInTheDocument();
  });

  // The card floated alone with no mark and no way back: a reader could
  // not tell which application was asking, nor leave without the browser.
  it("carries the brand and a way back to the landing page", async () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Yieldo" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("href", "/");
    // The page asks whether registration is open; let it answer before unmounting.
    await screen.findByRole("link", { name: "Créer un compte" });
  });

  it("labels both fields in French", async () => {
    renderPage();
    expect(screen.getByLabelText("Adresse email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    await screen.findByRole("link", { name: "Créer un compte" });
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
