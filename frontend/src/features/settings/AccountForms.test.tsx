import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "../auth/session";
import { PasswordForm } from "./PasswordForm";
import { ProfileForm } from "./ProfileForm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const USER = { id: 1, email: "max@example.com", name: "Max", role: "admin" };

beforeEach(() => {
  useSession.setState({
    user: USER,
    accessToken: "token",
    status: "authenticated",
    isAuthenticated: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useSession.setState({ user: null, accessToken: null, status: "idle", isAuthenticated: false });
});

describe("ProfileForm", () => {
  it("starts on the account's own values with nothing to save", () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText("Nom")).toHaveValue("Max");
    expect(screen.getByLabelText("Adresse email")).toHaveValue("max@example.com");
    expect(screen.getByRole("button", { name: /Enregistrer le profil/ })).toBeDisabled();
  });

  // Only the changed field goes on the wire: an unchanged email sent back would
  // make the backend run its uniqueness check against this account's own row
  // for no reason.
  it("sends only what actually changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...USER, name: "Maxime" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ProfileForm />);

    await user.clear(screen.getByLabelText("Nom"));
    await user.type(screen.getByLabelText("Nom"), "Maxime");
    await user.click(screen.getByRole("button", { name: /Enregistrer le profil/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({ name: "Maxime" });
  });

  it("puts the updated account back into the session so the shell follows it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...USER, name: "Maxime" })));
    const user = userEvent.setup();
    render(<ProfileForm />);

    await user.clear(screen.getByLabelText("Nom"));
    await user.type(screen.getByLabelText("Nom"), "Maxime");
    await user.click(screen.getByRole("button", { name: /Enregistrer le profil/ }));

    await screen.findByText("Profil enregistré.");
    expect(useSession.getState().user?.name).toBe("Maxime");
  });

  // Printed verbatim: the backend's sentence names which of two things went
  // wrong, and paraphrasing it is how a screen reports the other one.
  it("shows the backend's refusal word for word", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: "Un compte avec cet email existe déjà" }, 409),
      ),
    );
    const user = userEvent.setup();
    render(<ProfileForm />);

    await user.clear(screen.getByLabelText("Adresse email"));
    await user.type(screen.getByLabelText("Adresse email"), "lea@example.com");
    await user.click(screen.getByRole("button", { name: /Enregistrer le profil/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Un compte avec cet email existe déjà",
    );
  });
});

describe("PasswordForm", () => {
  it("cannot be submitted until all three fields are filled", () => {
    render(<PasswordForm />);
    expect(screen.getByRole("button", { name: /Changer le mot de passe/ })).toBeDisabled();
  });

  // The one check that lives only in the client: the backend cannot tell a typo
  // from an intention, and a mistyped new password is discovered at the next
  // login with no way back.
  it("refuses a confirmation that does not match, without asking the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Mot de passe actuel"), "motdepasse123");
    await user.type(screen.getByLabelText("Nouveau mot de passe"), "nouveaumotdepasse");
    await user.type(screen.getByLabelText("Confirmer le nouveau mot de passe"), "nouveaumotdepass");
    await user.click(screen.getByRole("button", { name: /Changer le mot de passe/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ne correspond pas/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a new password under the backend's own floor before the round trip", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Mot de passe actuel"), "motdepasse123");
    await user.type(screen.getByLabelText("Nouveau mot de passe"), "court");
    await user.type(screen.getByLabelText("Confirmer le nouveau mot de passe"), "court");
    await user.click(screen.getByRole("button", { name: /Changer le mot de passe/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/au moins 8 caractères/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears all three fields once the change is accepted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Mot de passe actuel"), "motdepasse123");
    await user.type(screen.getByLabelText("Nouveau mot de passe"), "nouveaumotdepasse");
    await user.type(
      screen.getByLabelText("Confirmer le nouveau mot de passe"),
      "nouveaumotdepasse",
    );
    await user.click(screen.getByRole("button", { name: /Changer le mot de passe/ }));

    await screen.findByText("Mot de passe modifié.");
    // No password is left on screen after a successful change.
    expect(screen.getByLabelText("Mot de passe actuel")).toHaveValue("");
    expect(screen.getByLabelText("Nouveau mot de passe")).toHaveValue("");
    expect(screen.getByLabelText("Confirmer le nouveau mot de passe")).toHaveValue("");
  });

  it("shows the backend's refusal when the current password is wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: "Le mot de passe actuel est incorrect" }, 403),
      ),
    );
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Mot de passe actuel"), "paslebon");
    await user.type(screen.getByLabelText("Nouveau mot de passe"), "nouveaumotdepasse");
    await user.type(
      screen.getByLabelText("Confirmer le nouveau mot de passe"),
      "nouveaumotdepasse",
    );
    await user.click(screen.getByRole("button", { name: /Changer le mot de passe/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le mot de passe actuel est incorrect",
    );
  });
});
