import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { ChatStep } from "../../lib/types";
import { ReasoningTrace, ThinkingIndicator, screenName, screensTouched } from "./ReasoningTrace";

const STEPS: ChatStep[] = [
  {
    tool: "engines/intent",
    label: "Lecture de la question",
    source: "intention reconnue : total_by_category",
    screen: null,
  },
  {
    tool: "relevé",
    label: "Lecture du relevé",
    source: "197 opérations, 12 catégories, du 2025-11-01 au 2026-09-03",
    screen: "/transactions",
  },
  {
    tool: "engines/aggregate",
    label: "Somme par catégorie",
    source: "catégorie « Courses »",
    screen: "/budgets",
  },
];

function mount(steps: ChatStep[], fresh = true) {
  return render(
    <MemoryRouter>
      <ReasoningTrace steps={steps} fresh={fresh} />
    </MemoryRouter>,
  );
}

describe("ReasoningTrace", () => {
  it("prints every step it was given, and nothing it was not", () => {
    // The whole point of the panel: the front end never writes a step. A
    // component that padded a short trace with a plausible fourth line would
    // be exactly the fabrication this feature exists to avoid.
    mount(STEPS);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Lecture du relevé")).toBeInTheDocument();
    expect(screen.getByText(/197 opérations/)).toBeInTheDocument();
  });

  it("names the tool that ran, verbatim", () => {
    mount(STEPS);
    expect(screen.getByText("engines/aggregate")).toBeInTheDocument();
    expect(screen.getByText("engines/intent")).toBeInTheDocument();
  });

  it("turns each screen into a link that actually goes there", () => {
    // "Les pages qu'il interroge" has to be reachable, not a label.
    mount(STEPS);
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute(
      "href",
      "/transactions",
    );
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute("href", "/budgets");
  });

  it("offers no link for a step no screen shows", () => {
    mount([STEPS[0]]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("counts the screens touched, not the steps", () => {
    // Two of the three steps name a screen, and one of them names none.
    mount(STEPS);
    expect(screen.getByRole("button", { name: /2 écrans interrogés/ })).toBeInTheDocument();
  });

  it("opens on a fresh answer and stays closed on a stored one", async () => {
    const { unmount } = mount(STEPS, true);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    unmount();

    mount(STEPS, false);
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
    expect(screen.queryByText("Lecture du relevé")).toBeNull();
  });

  it("can be opened again by hand", async () => {
    const user = userEvent.setup();
    mount(STEPS, false);
    await user.click(screen.getByRole("button", { name: /Raisonnement/ }));
    expect(screen.getByText("Lecture du relevé")).toBeInTheDocument();
  });

  it("renders nothing at all rather than an empty frame", () => {
    // A trace is never empty in practice — even an unparsed question reports
    // its own reading — but an empty panel would be a lie about the answer.
    const { container } = mount([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("screensTouched", () => {
  it("keeps first-mention order and drops repeats", () => {
    const steps: ChatStep[] = [
      { ...STEPS[1], screen: "/tresorerie" },
      { ...STEPS[2], screen: "/budgets" },
      { ...STEPS[1], screen: "/tresorerie" },
    ];
    expect(screensTouched(steps)).toEqual(["/tresorerie", "/budgets"]);
  });
});

describe("screenName", () => {
  it("falls back to the route rather than inventing a name", () => {
    expect(screenName("/budgets")).toBe("Budgets");
    expect(screenName("/inconnu")).toBe("/inconnu");
  });
});

describe("ThinkingIndicator", () => {
  it("says a query is running and claims nothing more", () => {
    // Deliberately NOT a step list ticking through phases: the front end
    // cannot see the backend's, and a fake progress report is worse than none.
    render(<ThinkingIndicator />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Exécution de la requête sur vos relevés");
    expect(status).not.toHaveTextContent("engines/");
  });
});

describe("conversationMeta", () => {
  it("counts the questions and dates the thread by its LAST one", async () => {
    // `last_at`, because the list is ordered on it: a date naming the first
    // question would put the rows in an order the dates appear to contradict.
    const { conversationMeta } = await import("./AssistantDrawer");
    expect(
      conversationMeta({
        id: 1,
        title: "Où en sont mes budgets ?",
        started_at: "2026-09-01T09:00:00Z",
        last_at: "2026-09-04T09:00:00Z",
        message_count: 3,
      }),
    ).toBe("3 questions · 4 septembre");
  });

  it("keeps the singular for a thread of one", async () => {
    const { conversationMeta } = await import("./AssistantDrawer");
    expect(
      conversationMeta({
        id: 2,
        title: "Quel est mon solde net ?",
        started_at: "2026-09-04T09:00:00Z",
        last_at: "2026-09-04T09:00:00Z",
        message_count: 1,
      }),
    ).toBe("1 question · 4 septembre");
  });
});
