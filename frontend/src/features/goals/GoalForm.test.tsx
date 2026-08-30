import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GoalProgress } from "../../lib/types";
import { GoalForm } from "./GoalForm";

/** What `/api/goals` actually returns for one row. Note what is NOT here:
 *  `GoalProgressOut` carries no `priority`, so an edit cannot prefill it. */
const EXISTING: GoalProgress = {
  goal_id: 7,
  name: "Vacances",
  target_cents: 150_000,
  saved_cents: 25_050,
  remaining_cents: 124_950,
  progress_ratio: 0.167,
  milestones: [],
  funding_starts_in_months: 0,
  months_to_completion: null,
  projected_completion_on: null,
  projection_unavailable_reason: null,
  due_on: "2027-07-01",
  months_until_due: 11,
  on_track: null,
};

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({}, 201));
  vi.stubGlobal("fetch", fetchMock);
});

describe("GoalForm", () => {
  it("sends euros as integer cents, never through a float", async () => {
    // 8,70 € through `parseFloat(x) * 100` is 869.9999999999999. The form uses
    // `parseCents`, which is string arithmetic end to end.
    const user = userEvent.setup();
    render(<GoalForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Fonds d'urgence");
    await user.type(screen.getByLabelText(/Montant visé/), "8,70");
    await user.type(screen.getByLabelText(/Déjà mis de côté/), "8,70");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(body.target_cents).toBe(870);
      expect(body.saved_cents).toBe(870);
      expect(body.name).toBe("Fonds d'urgence");
    });
  });

  it("says outright which end of the priority scale is the urgent one", () => {
    // "Priorité 1" is meaningless without it, and the whole funding queue —
    // one goal at a time, most urgent first — hangs off this number.
    render(<GoalForm onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/1 = la plus urgente/)).toBeInTheDocument();
  });

  it("refuses a target of zero at the field, and sends nothing", async () => {
    // `schemas.GoalIn.target_cents` is `gt=0`. A round trip to be told what the
    // field already knows is not a way to report an input error.
    const user = userEvent.setup();
    render(<GoalForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Rien");
    await user.type(screen.getByLabelText(/Montant visé/), "0");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    const target = screen.getByLabelText(/Montant visé/);
    expect(target).toHaveAttribute("aria-invalid", "true");
    expect(target).toHaveAttribute("aria-describedby");
    expect(await screen.findByRole("alert")).toHaveTextContent(/strictement positif/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreadable amount at the field rather than saving it as nothing", async () => {
    const user = userEvent.setup();
    render(<GoalForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Voiture");
    await user.type(screen.getByLabelText(/Montant visé/), "huit mille");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(await screen.findByText(/Montant illisible/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends no deadline as null rather than as an empty string", async () => {
    // `schemas.GoalIn.due_on` is `date | None`; "" is neither and comes back a
    // 422. A goal without a deadline is the normal case, not an error.
    const user = userEvent.setup();
    render(<GoalForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Intitulé/), "Voyage");
    await user.type(screen.getByLabelText(/Montant visé/), "1500");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(body.due_on).toBeNull();
      expect(body.target_cents).toBe(150_000);
    });
  });

  it("patches an existing goal and leaves the priority it cannot see alone", async () => {
    // `/api/goals` returns `GoalProgressOut`, which carries no `priority`. The
    // form therefore starts that one field EMPTY and omits it from the patch,
    // rather than sending a default that would silently re-rank the queue.
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({}, 200));
    render(<GoalForm goal={EXISTING} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/Montant visé/)).toHaveValue("1500,00");
    expect(screen.getByLabelText(/Déjà mis de côté/)).toHaveValue("250,50");
    expect(screen.getByLabelText(/Échéance/)).toHaveValue("2027-07-01");
    expect(screen.getByLabelText(/1 = la plus urgente/)).toHaveValue("");

    await user.clear(screen.getByLabelText(/Déjà mis de côté/));
    await user.type(screen.getByLabelText(/Déjà mis de côté/), "300");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/goals/7");
      expect(init.method).toBe("PATCH");
      const body = JSON.parse(String(init.body));
      expect(body.saved_cents).toBe(30_000);
      expect(body).not.toHaveProperty("priority");
    });
  });

  it("surfaces a rejection from the backend instead of failing silently", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Objectif introuvable" }, 404));
    render(<GoalForm goal={EXISTING} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Objectif introuvable");
  });
});
