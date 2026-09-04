import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessKeyPanel, lastUsedLabel, remainingLabel } from "./AccessKeyPanel";

const KEY = {
  key: "yld_a1b2c3d4e5f6_" + "0".repeat(64),
  created_at: "2026-09-04T08:00:00+00:00",
  expires_at: "2026-09-05T08:00:00+00:00",
  last_used_at: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Replace `navigator.clipboard` for one test.
 *
 * `vi.stubGlobal("navigator", { ...navigator })` does not work here: almost
 * everything on `navigator` lives on its prototype, so the spread copies
 * nothing. And it has to happen AFTER `userEvent.setup()`, which installs a
 * clipboard stub of its own and would otherwise overwrite this one. */
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("remainingLabel", () => {
  it("counts down in hours and minutes", () => {
    expect(remainingLabel("2026-09-04T12:30:00Z", new Date("2026-09-04T00:00:00Z"))).toBe(
      "expire dans 12 h 30",
    );
  });

  it("drops to minutes in the last hour", () => {
    expect(remainingLabel("2026-09-04T00:07:00Z", new Date("2026-09-04T00:00:00Z"))).toBe(
      "expire dans 7 min",
    );
  });

  // Not "expire dans 0 min": a key past its instant does not expire, it has.
  it("says so once the key has run out", () => {
    expect(remainingLabel("2026-09-03T00:00:00Z", new Date("2026-09-04T00:00:00Z"))).toBe(
      "expirée",
    );
  });
});

describe("lastUsedLabel", () => {
  it("states that a key has never been used rather than showing a blank", () => {
    expect(lastUsedLabel(null)).toBe("jamais utilisée");
  });
});

describe("AccessKeyPanel", () => {
  it("reads the key with a GET, which must never rotate it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(KEY));
    vi.stubGlobal("fetch", fetchMock);

    render(<AccessKeyPanel />);

    await screen.findByRole("button", { name: "Afficher la clé" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/access-key");
    expect(init?.method ?? "GET").toBe("GET");
  });

  // The panel sits on a screen an operator opens in front of other people.
  it("masks the key until it is asked for", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(KEY)));
    const user = userEvent.setup();
    render(<AccessKeyPanel />);

    const reveal = await screen.findByRole("button", { name: "Afficher la clé" });
    expect(screen.queryByText(KEY.key)).not.toBeInTheDocument();

    await user.click(reveal);

    expect(screen.getByText(KEY.key)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Masquer la clé" })).toBeInTheDocument();
  });

  it("copies without ever revealing the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(KEY)));
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<AccessKeyPanel />);

    await user.click(await screen.findByRole("button", { name: "Copier la clé" }));

    expect(writeText).toHaveBeenCalledWith(KEY.key);
    await screen.findByText("Clé copiée.");
    expect(screen.queryByText(KEY.key)).not.toBeInTheDocument();
  });

  // A refused clipboard is not a failure worth a red panel: the key is one
  // click from being selectable by hand, so the panel shows it and says so.
  it("falls back to showing the key when the clipboard is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(KEY)));
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<AccessKeyPanel />);

    await user.click(await screen.findByRole("button", { name: "Copier la clé" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/presse-papiers/);
    expect(screen.getByText(KEY.key)).toBeInTheDocument();
  });

  it("rotates on demand and shows the new key straight away", async () => {
    const rotated = { ...KEY, key: "yld_ffffffffffff_" + "1".repeat(64) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(KEY))
      .mockResolvedValueOnce(jsonResponse(rotated));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AccessKeyPanel />);

    await user.click(await screen.findByRole("button", { name: /Renouveler maintenant/ }));

    await waitFor(() => expect(screen.getByText(rotated.key)).toBeInTheDocument());
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/access-key/rotate");
  });

  it("says plainly that nothing can reach the account once the key is revoked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(KEY))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AccessKeyPanel />);

    await user.click(await screen.findByRole("button", { name: /Révoquer/ }));

    expect(await screen.findByText(/Aucune clé active/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Émettre une clé/ })).toBeInTheDocument();
  });

  it("shows the backend's refusal rather than an empty panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Authentification requise" }, 401)),
    );
    render(<AccessKeyPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Authentification requise");
  });
});
