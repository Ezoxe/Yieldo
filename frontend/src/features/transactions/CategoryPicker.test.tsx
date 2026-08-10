import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CategoryPicker } from "./CategoryPicker";

const categories = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 2, parent_id: 1, name: "Courses", slug: "alimentation-courses",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 3, parent_id: null, name: "Logement", slug: "logement",
    kind: "expense", color: "#7ee2d6", icon: "home", monthly_budget_cents: null },
];

describe("CategoryPicker", () => {
  it("shows the placeholder when nothing is selected", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} categories={categories} />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "Toutes les catégories");
  });

  it("shows the selected category's own name, not its parent's", () => {
    render(<CategoryPicker value={2} onChange={vi.fn()} categories={categories} />);
    expect(screen.getByRole("combobox")).toHaveValue("Courses");
  });

  it("lists every category grouped by parent when opened", async () => {
    const user = userEvent.setup();
    render(<CategoryPicker value={null} onChange={vi.fn()} categories={categories} />);

    await user.click(screen.getByRole("combobox"));

    expect(screen.getByRole("option", { name: "Alimentation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Courses" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Logement" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Toutes les catégories" })).toBeInTheDocument();
  });

  it("filters the list as the user types (keyboard search)", async () => {
    const user = userEvent.setup();
    render(<CategoryPicker value={null} onChange={vi.fn()} categories={categories} />);

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "cour");

    expect(screen.getByRole("option", { name: "Courses" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Logement" })).not.toBeInTheDocument();
  });

  it("reports the chosen category on click and closes the list", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CategoryPicker value={null} onChange={onChange} categories={categories} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Courses" }));

    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects the highlighted option with ArrowDown then Enter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CategoryPicker value={null} onChange={onChange} categories={categories} />);

    const combobox = screen.getByRole("combobox");
    await user.click(combobox);
    // First option is "Toutes les catégories" (id null); one ArrowDown reaches
    // "Alimentation" (id 1).
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("clears the filter when 'Toutes les catégories' is chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CategoryPicker value={2} onChange={onChange} categories={categories} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Toutes les catégories" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("closes on Escape without changing the selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CategoryPicker value={2} onChange={onChange} categories={categories} />);

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "log");
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("Courses");
  });
});
