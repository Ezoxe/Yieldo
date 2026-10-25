import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BentoGrid } from "../../design/bento/BentoGrid";
import { PreparedImports } from "./PreparedImports";

const fetchMock = vi.fn();

const prepared = [
  {
    id: 4,
    account_id: 2,
    account_name: "Courant",
    filename: "releve-octobre.csv",
    rows: 31,
    created_at: "2026-10-25T09:12:00Z",
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupFetch(list: unknown = prepared) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/imports/pending" && method === "GET") {
      return Promise.resolve(jsonResponse(list));
    }
    if (url === "/api/imports/pending/4/file" && method === "GET") {
      return Promise.resolve(
        new Response("Date;Libellé;Montant\n", { headers: { "Content-Type": "text/csv" } }),
      );
    }
    if (url === "/api/imports/pending/4" && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url}`);
  });
}

function renderPanel(onOpen = vi.fn().mockResolvedValue(undefined)) {
  render(
    <BentoGrid>
      <PreparedImports onOpen={onOpen} span={{ md: 6, lg: 12 }} reduced />
    </BentoGrid>,
  );
  return onOpen;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("PreparedImports", () => {
  it("lists what Claude prepared, with its account and its row count", async () => {
    setupFetch();
    renderPanel();

    expect(await screen.findByText("Préparé par Claude")).toBeInTheDocument();
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("releve-octobre.csv");
    expect(item).toHaveTextContent("Courant");
    expect(item).toHaveTextContent("31 lignes lues");
  });

  it("shows nothing at all when nothing was prepared", async () => {
    setupFetch([]);
    renderPanel();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Préparé par Claude")).not.toBeInTheDocument();
  });

  it("hands the file to the wizard, named like the row, on its own account", async () => {
    setupFetch();
    const onOpen = renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir" }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    const [item, file] = onOpen.mock.calls[0] as [{ account_id: number }, File];
    expect(item.account_id).toBe(2);
    expect(file.name).toBe("releve-octobre.csv");
    expect(await file.text()).toBe("Date;Libellé;Montant\n");
  });

  it("sets a prepared statement aside without importing it", async () => {
    setupFetch();
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Écarter" }));

    await waitFor(() => expect(screen.queryByText("releve-octobre.csv")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/pending/4",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
