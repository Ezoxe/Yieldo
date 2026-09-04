import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Recurrence } from "../../lib/types";
import {
  describeSpread,
  exclusionReason,
  formatRatio,
  RecurrenceDetail,
  RecurrenceRow,
} from "./RecurrenceRow";

const LEDGER_LAST_ON = "2026-05-02";

const base: Recurrence = {
  label: "PRELEVEMENT SEPA NETFLIX INTERNATIONAL BV",
  label_key: "prelevement sepa netflix international bv",
  category_id: 12,
  category_name: "Streaming",
  category_color: "#7ee2d6",
  periodicity: "monthly",
  occurrences: 8,
  first_on: "2025-09-10",
  last_on: "2026-04-10",
  median_interval_days: 30,
  amount_cents: -1599,
  amount_spread_cents: 0,
  annual_cents: -19188,
  observed_span_days: 212,
  annualisable: true,
  expected_next_on: "2026-05-10",
  status: "active",
  confidence: "confirmed",
  price_change: null,
};

/** A detected burst: real rhythm, far too short a window to cost a year from. */
const burst: Recurrence = {
  ...base,
  label: "CARTE X1234 FNAC DARTY",
  label_key: "x1234 fnac darty",
  category_name: "Équipement et high-tech",
  periodicity: "weekly",
  occurrences: 6,
  first_on: "2025-12-13",
  last_on: "2026-01-04",
  median_interval_days: 5,
  amount_cents: -16088,
  amount_spread_cents: 4181,
  annual_cents: -836576,
  observed_span_days: 22,
  annualisable: false,
  expected_next_on: "2026-01-09",
};

/** The list row: the mark, the merchant, the rhythm, the state, the amount. */
function renderRow(recurrence: Recurrence) {
  return render(
    <ul>
      <RecurrenceRow recurrence={recurrence} onOpen={() => {}} />
    </ul>,
  );
}

/**
 * The panel the row opens.
 *
 * Most of the assertions below moved here rather than being deleted: the seven
 * paragraphs they cover are still written, in full, one click away. What
 * changed is where they are — see `RecurrenceDetail`.
 */
function renderDetail(recurrence: Recurrence, ledgerLastOn: string | null = LEDGER_LAST_ON) {
  return render(<RecurrenceDetail recurrence={recurrence} ledgerLastOn={ledgerLastOn} />);
}

describe("formatRatio", () => {
  it("writes a rise with a sign and one decimal, French style", () => {
    expect(formatRatio(0.185)).toBe("+18,5 %");
  });

  it("writes a fall with a typographic minus", () => {
    expect(formatRatio(-0.072)).toBe("−7,2 %");
  });
});

describe("describeSpread", () => {
  it("calls a charge that never moves constant, and not unstable", () => {
    const spread = describeSpread(-1599, 0);
    expect(spread.unstable).toBe(false);
    expect(spread.text).toMatch(/constant/i);
  });

  it("reports a wobble too small to matter without raising an alarm", () => {
    // 12 cents on 15,99 € is 0,75 % — an FX rounding, not a varying charge.
    const spread = describeSpread(-1599, 12);
    expect(spread.unstable).toBe(false);
    expect(spread.text).toMatch(/0,12/);
  });

  it("flags a charge whose amount moves by more than a twentieth", () => {
    const spread = describeSpread(-16088, 4181);
    expect(spread.unstable).toBe(true);
    expect(spread.text).toMatch(/41,81/);
    expect(spread.text).toMatch(/160,88/);
  });

  it("does not divide by a zero level", () => {
    expect(describeSpread(0, 500).unstable).toBe(true);
    expect(describeSpread(0, 0).unstable).toBe(false);
  });
});

describe("exclusionReason", () => {
  it("counts a live, annualisable expense in the total", () => {
    expect(exclusionReason(base)).toBeNull();
  });

  it("keeps a run observed for less than a quarter out of the total", () => {
    expect(exclusionReason(burst)).toMatch(/91 jours/);
  });

  it("keeps recurring income out of a subscription cost", () => {
    expect(exclusionReason({ ...base, amount_cents: 118200, annual_cents: 1418400 })).toMatch(
      /[Rr]evenu/,
    );
  });

  it("keeps a recurrence with no recent charge out of the total", () => {
    expect(exclusionReason({ ...base, status: "ended" })).not.toBeNull();
  });

  // The short-window gate comes first in the engine, so it must come first
  // here: a short-window *income* is excluded for both reasons and naming the
  // annualisation one keeps the screen's arithmetic legible.
  it("names the annualisation gate first when two reasons apply", () => {
    expect(exclusionReason({ ...burst, amount_cents: 16088, annual_cents: 836576 })).toMatch(
      /91 jours/,
    );
  });
});

describe("RecurrenceRow", () => {
  it("names the charge, its rhythm and its amount, and nothing else", () => {
    renderRow(base);
    expect(screen.getByText(/NETFLIX/)).toBeInTheDocument();
    expect(screen.getByText("Mensuel")).toBeInTheDocument();
    expect(screen.getByText(/15,99/)).toBeInTheDocument();
    // The annual cost is a detail, and details are in the panel: a row that
    // carried it carried six other sentences with it.
    expect(screen.queryByText(/191,88/)).not.toBeInTheDocument();
  });

  it("opens the detail panel when pressed", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ul>
        <RecurrenceRow recurrence={base} onOpen={onOpen} />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: /NETFLIX/ }));

    expect(onOpen).toHaveBeenCalledWith(base);
  });

  // Two states earn a badge on the row, and only two: a green "Actif" chip on
  // every ordinary line is a wall of green chips.
  it("badges only what is not ordinary", () => {
    renderRow(base);
    expect(screen.queryByText("Actif")).not.toBeInTheDocument();

    renderRow({ ...base, status: "missing" });
    expect(screen.getByText("Prélèvement manquant")).toBeInTheDocument();
  });

  it("states the annual cost in the detail panel", () => {
    renderDetail(base);
    expect(screen.getByText(/191,88/)).toBeInTheDocument();
  });

  // The whole point of the 91-day rule: 8 365,76 € is a real number in the
  // payload and a lie on the screen.
  it("never prints an annual figure for a run it may not annualise", () => {
    renderDetail(burst);
    expect(screen.queryByText(/365,76/)).not.toBeInTheDocument();
    expect(screen.getByText(/22 jours/)).toBeInTheDocument();
    expect(screen.getByText(/91 jours/)).toBeInTheDocument();
  });

  it("states a price rise with both amounts and the percentage", () => {
    renderDetail({
      ...base,
      price_change: {
        previous_cents: -1349,
        current_cents: -1599,
        changed_on: "2026-01-10",
        ratio: 0.1853,
      },
    });
    expect(screen.getByText(/13,49/)).toBeInTheDocument();
    // Once here, not twice. The other statement of the same figure — what is
    // billed now — is on the row and in the panel's own subtitle; this line
    // says what it rose TO, which is a different claim about the same number.
    expect(screen.getByText(/15,99/)).toBeInTheDocument();
    expect(screen.getByText(/\+18,5 %/)).toBeInTheDocument();
    expect(screen.getByText(/janvier 2026/)).toBeInTheDocument();
  });

  // 2026-05-20, not the default ledger date: `missing` means the engine's
  // `today` — the ledger's own last date — is already past `expected_next_on`
  // plus its grace period, so a ledger stopping on 2 May could never have
  // produced this status. The payload a test exhibits has to be one the
  // backend can send.
  it("says when an expected debit did not arrive", () => {
    renderDetail({ ...base, status: "missing" }, "2026-05-20");
    const status = screen.getByText(/Attendu le 10 mai 2026/);
    expect(status).toHaveTextContent(/il n'est pas arrivé/);
    expect(status).toHaveTextContent(/10 jours après l'échéance attendue/);
  });

  // `ended` is a statement about the ledger, never about the merchant: the
  // statements kept arriving for months and the charge did not. That is a real
  // observation, and blaming the import here would bury it.
  it("reports the gap in days when the ledger ran on without the charge", () => {
    renderDetail(
      { ...base, status: "ended", last_on: "2025-09-14", expected_next_on: "2025-10-14" },
      "2026-05-02",
    );
    const status = screen.getByText(/Aucun prélèvement depuis le 14 septembre 2025/);
    expect(status).toHaveTextContent(/200 jours après l'échéance attendue/);
    expect(status).toHaveTextContent(/vos relevés se sont poursuivis sans ce prélèvement/);
    expect(screen.queryByText(/aucun relevé plus récent/)).not.toBeInTheDocument();
    expect(screen.queryByText(/résilié/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interrompu/)).not.toBeInTheDocument();
  });

  // The guard branch, and it is exhibited here **as a guard**: `ledgerClause`
  // documents why the current API cannot emit this payload — the route passes
  // `ledger_last_on` as the engine's `today`, and both stale statuses require
  // that date to be past `expected_next_on`. This test pins what the guard
  // would say the day that coupling changes; it is not prose the operator sees
  // today, and no other test should read as though it were.
  it("blames the missing statements when the ledger stops before the due date", () => {
    renderDetail({ ...base, status: "ended" }, "2026-05-02");
    expect(screen.getByText(/Aucun prélèvement depuis le 10 avril 2026/)).toBeInTheDocument();
    expect(screen.getByText(/2 mai 2026/)).toBeInTheDocument();
    expect(screen.getByText(/dernière date de votre historique/)).toBeInTheDocument();
    expect(screen.getByText(/aucun relevé plus récent n'ait été importé/)).toBeInTheDocument();
    // Whatever the clock, the sentence never asserts a cancellation.
    expect(screen.queryByText(/résilié/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interrompu/)).not.toBeInTheDocument();
    // And never a negative day count, which is what dropping the guard would
    // print on this payload.
    expect(screen.queryByText(/−8 jours|-8 jours/)).not.toBeInTheDocument();
  });

  it("still says something honest about a silence when the ledger is unknown", () => {
    renderDetail({ ...base, status: "ended" }, null);
    expect(screen.getByText(/Aucun prélèvement depuis le 10 avril 2026/)).toBeInTheDocument();
  });

  it("marks a three-occurrence detection as uncertain in words", () => {
    renderDetail({ ...base, occurrences: 3, confidence: "probable" });
    expect(screen.getByText(/Probable/)).toBeInTheDocument();
    expect(screen.getByText(/3 occurrences/)).toBeInTheDocument();
  });

  it("does not claim uncertainty it does not have", () => {
    renderDetail(base);
    expect(screen.queryByText(/Probable/)).not.toBeInTheDocument();
  });

  // normalize_label strips the card number, so every withdrawal lands in one
  // clockwork group. The spread is the only thing on screen that says so.
  it("warns that a varying amount may be several operations under one label", () => {
    renderDetail(burst);
    expect(screen.getByText(/±/)).toBeInTheDocument();
    expect(screen.getByText(/plusieurs opérations/)).toBeInTheDocument();
  });

  it("does not warn about a charge that never varies", () => {
    renderDetail(base);
    expect(screen.queryByText(/plusieurs opérations/)).not.toBeInTheDocument();
    expect(screen.getByText(/constant/i)).toBeInTheDocument();
  });

  it("shows recurring income with a plus sign, not as a cost", () => {
    renderRow({ ...base, amount_cents: 118200, annual_cents: 1418400, category_name: "Salaire" });
    // \s, not a literal space: formatCents separates thousands with U+202F.
    expect(screen.getByText(/\+1\s182,00/)).toBeInTheDocument();
  });
});
