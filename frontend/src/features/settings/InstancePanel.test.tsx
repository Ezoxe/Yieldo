import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstancePanel } from "./InstancePanel";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const LABEL = "Autoriser la création d'autres comptes sur cette installation";

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("InstancePanel", () => {
  it("opens registration for the next household member", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ registration_open: false, source: "environment" }))
      .mockResolvedValueOnce(json({ registration_open: true, source: "instance" }));
    render(<InstancePanel />);

    const box = await screen.findByRole("switch", { name: LABEL });
    expect(box).not.toBeChecked();
    await userEvent.click(box);

    expect(await screen.findByRole("switch", { name: LABEL, checked: true })).toBeChecked();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/settings");
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ registration_open: true });
  });

  it("prints the backend's refusal", async () => {
    fetchMock.mockResolvedValue(json({ detail: "Droits administrateur requis" }, 403));
    render(<InstancePanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Droits administrateur requis");
  });
});
