import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLedgerMode } from "../features/plan/useLedgerMode";
import { api } from "./api";
import { apiQueryKey, useApiQuery, useInvalidate } from "./useApiQuery";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

const getMock = vi.mocked(api.get);

function Probe({ path }: { path: string }) {
  const query = useApiQuery<{ total: number }>(path);
  if (query.isPending) return <p>chargement</p>;
  if (query.error) return <p role="alert">{query.error.detail}</p>;
  return <p>total {query.data.total}</p>;
}

function Invalidator({ path }: { path: string }) {
  const invalidate = useInvalidate();
  return (
    <button type="button" onClick={() => void invalidate(path)}>
      recharger
    </button>
  );
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, ...view };
}

beforeEach(() => {
  getMock.mockReset();
  useLedgerMode.setState({ mode: "real", loaded: true });
});

describe("useApiQuery", () => {
  it("answers from the API and reports pending until it does", async () => {
    getMock.mockResolvedValue({ total: 42 });
    renderWithClient(<Probe path="/analytics/summary" />);

    expect(screen.getByText("chargement")).toBeInTheDocument();
    expect(await screen.findByText("total 42")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/analytics/summary", undefined);
  });

  // The whole point of the cache: leaving a screen and coming back inside the
  // stale window paints the answer already held instead of a skeleton and a
  // second round trip.
  it("does not ask twice for the same path inside the stale window", async () => {
    getMock.mockResolvedValue({ total: 42 });
    const { client, unmount } = renderWithClient(<Probe path="/analytics/summary" />);
    await screen.findByText("total 42");
    unmount();

    render(
      <QueryClientProvider client={client}>
        <Probe path="/analytics/summary" />
      </QueryClientProvider>,
    );
    expect(screen.getByText("total 42")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  // Every analytics route answers differently per ledger mode, and the shell
  // re-keys the screens on it. A cache that ignored the mode would serve the
  // « Réel » figure under the « Estimé » label.
  it("files the answer under the ledger mode, so a change of mode asks again", async () => {
    getMock.mockResolvedValue({ total: 42 });
    const { client, unmount } = renderWithClient(<Probe path="/analytics/summary" />);
    await screen.findByText("total 42");
    unmount();

    useLedgerMode.setState({ mode: "estimated" });
    getMock.mockResolvedValue({ total: 7 });
    render(
      <QueryClientProvider client={client}>
        <Probe path="/analytics/summary" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("total 7")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(apiQueryKey("/analytics/summary", undefined, "estimated")).toEqual([
      "api", "estimated", "/analytics/summary", {},
    ]);
  });

  it("surfaces the backend's French detail rather than a generic failure", async () => {
    getMock.mockRejectedValue(new (await import("./api")).ApiError(503, "Le service est indisponible."));
    renderWithClient(<Probe path="/analytics/summary" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Le service est indisponible.");
  });

  it("asks again after the screen invalidates its own path", async () => {
    getMock.mockResolvedValue({ total: 42 });
    renderWithClient(
      <>
        <Probe path="/budgets" />
        <Invalidator path="/budgets" />
      </>,
    );
    await screen.findByText("total 42");

    getMock.mockResolvedValue({ total: 43 });
    screen.getByRole("button", { name: "recharger" }).click();
    await waitFor(() => expect(screen.getByText("total 43")).toBeInTheDocument());
    // The previous answer stayed painted while the new one was in flight: no
    // skeleton on a save, the screen's core interaction.
    expect(screen.queryByText("chargement")).not.toBeInTheDocument();
  });
});
