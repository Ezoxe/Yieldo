import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseIndexSeries, PriceIndexForm } from "./PriceIndexForm";

describe("parseIndexSeries", () => {
  it("reads semicolon-separated month and value pairs", () => {
    const { points, errors } = parseIndexSeries("2025-01;118,42\n2026-01;120.78");
    expect(errors).toEqual([]);
    expect(points).toEqual([
      { month: "2025-01", value: "118.42" },
      { month: "2026-01", value: "120.78" },
    ]);
  });

  it("accepts a tab or a comma as the separator, as a paste from a spreadsheet arrives", () => {
    expect(parseIndexSeries("2025-01\t118.42").points).toEqual([
      { month: "2025-01", value: "118.42" },
    ]);
    expect(parseIndexSeries("2025-01,118.42").points).toEqual([
      { month: "2025-01", value: "118.42" },
    ]);
  });

  it("ignores blank lines rather than failing on them", () => {
    const { points, errors } = parseIndexSeries("\n2025-01;118,42\n\n");
    expect(errors).toEqual([]);
    expect(points).toHaveLength(1);
  });

  // Named, and nothing is returned: PUT replaces the whole stored series, so
  // sending the readable lines alone would store a shorter series than the
  // reader pasted and erase the months the parser could not read.
  it("names the line that could not be read, and keeps back the whole series", () => {
    const { points, errors } = parseIndexSeries("2025-01;118,42\njanvier;abc");
    expect(points).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ligne 2/i);
  });

  it("refuses a month outside 01-12", () => {
    const { errors } = parseIndexSeries("2025-13;118,42");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ligne 1/i);
  });

  // `PriceIndexPointIn` types `value` as `Decimal = Field(gt=0, le=1_000_000)`,
  // so a negative or oversized level is refused by Pydantic — in ENGLISH,
  // through the schema-validation detail list. These three guards keep every
  // refusal the reader can provoke in French, and name the offending line.
  it("refuses a negative index level in French, naming the line", () => {
    const { points, errors } = parseIndexSeries("2025-01;-5");
    expect(points).toHaveLength(0);
    expect(errors[0]).toMatch(/ligne 1/i);
    expect(errors[0]).toMatch(/strictement positive/);
  });

  it("refuses a level that rounds to nothing at the hundredth", () => {
    // The backend's own post-rounding guard (see `replace_price_index`):
    // "0.004" clears `gt=0` and still stores 0 hundredths.
    const { errors } = parseIndexSeries("2025-01;0.004");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/centième/);
  });

  it("refuses a level past the backend's ceiling", () => {
    const { errors } = parseIndexSeries("2025-01;1000000.01");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/1 000 000/);
  });

  it("refuses the same month twice rather than letting one silently replace the other", () => {
    const { points, errors } = parseIndexSeries("2025-01;118,42\n2025-01;119,00");
    expect(points).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("2025-01");
  });
});

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse([{ month: "2025-01", value_hundredths: 11842 }]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function putCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
}

describe("PriceIndexForm", () => {
  it("says plainly that nothing is configured and that nothing is fetched", () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    expect(screen.getByText(/Aucun indice de référence/)).toBeInTheDocument();
    expect(screen.getByText(/aucune donnée n'est téléchargée/i)).toBeInTheDocument();
  });

  it("sends the parsed series as month and decimal-string pairs", async () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "2025-01;118,42");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    await waitFor(() => {
      const [put] = putCalls();
      expect(put).toBeDefined();
      expect(JSON.parse(put[1].body as string)).toEqual({
        points: [{ month: "2025-01", value: "118.42" }],
      });
    });
  });

  it("refuses to send a series it could not fully read", async () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "janvier;abc");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ligne 1/i);
    expect(putCalls()).toHaveLength(0);
  });

  it("lists every refused line separately rather than joining them into prose", async () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    await userEvent.type(
      screen.getByLabelText(/Série de l'indice/),
      "2025-01;118,42{Enter}janvier;abc{Enter}2026-01;-5",
    );
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    const alert = await screen.findByRole("alert");
    const items = within(alert).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/Ligne 2/);
    expect(items[1]).toHaveTextContent(/Ligne 3/);
    expect(putCalls()).toHaveLength(0);
  });

  // PUT replaces the stored series, so an empty payload erases it. Saving an
  // empty textarea is far more often a stray click than a decision.
  it("does not erase the stored series when the textarea is empty", async () => {
    render(
      <PriceIndexForm points={[{ month: "2025-01", value_hundredths: 11842 }]} onSaved={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Aucune ligne à enregistrer/);
    expect(putCalls()).toHaveLength(0);
  });

  it("clears the stored series through its own button", async () => {
    const onSaved = vi.fn();
    render(
      <PriceIndexForm points={[{ month: "2025-01", value_hundredths: 11842 }]} onSaved={onSaved} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Effacer l'indice/ }));

    await waitFor(() => {
      const [put] = putCalls();
      expect(put).toBeDefined();
      expect(JSON.parse(put[1].body as string)).toEqual({ points: [] });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("offers no clear button while nothing is stored", () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Effacer l'indice/ })).not.toBeInTheDocument();
  });

  it("shows how many months are stored once there are some", () => {
    render(
      <PriceIndexForm points={[{ month: "2025-01", value_hundredths: 11842 }]} onSaved={vi.fn()} />,
    );
    expect(screen.getByText(/1 mois enregistré/)).toBeInTheDocument();
  });

  it("names the stored span and the levels it holds", () => {
    render(
      <PriceIndexForm
        points={[
          { month: "2025-01", value_hundredths: 11842 },
          { month: "2026-01", value_hundredths: 12078 },
        ]}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 mois enregistrés, de 2025-01 à 2026-01/)).toBeInTheDocument();
  });

  it("reports the backend's own refusal rather than a generic failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Le mois 2025-01 apparaît deux fois dans la série." }, 422),
    );
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "2025-01;118,42");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/apparaît deux fois/);
  });

  // A schema-validation 422 carries a LIST of `{loc, msg, type}` rather than a
  // string. `lib/api.ts`'s `readError` is where the two shapes are told apart;
  // this pins that a form provoking one renders the message and never
  // "[object Object]".
  it("renders a schema-validation detail list as its message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { detail: [{ loc: ["body", "points", 0, "value"], msg: "Valeur refusée", type: "x" }] },
        422,
      ),
    );
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "2025-01;118,42");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Valeur refusée");
    expect(alert.textContent).not.toContain("[object Object]");
  });

  it("tells the caller to reload once the series has been stored", async () => {
    const onSaved = vi.fn();
    render(<PriceIndexForm points={[]} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "2025-01;118,42");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
