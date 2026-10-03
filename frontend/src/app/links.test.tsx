import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { useMotionPreference } from "../design/motion/motionPreference";
import { Link, NavLink } from "./links";

afterEach(() => {
  delete document.documentElement.dataset.vtDir;
  useMotionPreference.setState({ disabled: false });
});

function renderAt(path: string, ui: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the app's own links", () => {
  // The screen transition reads the direction from the document root: a
  // detail arrives from the right, the way back leaves to the right.
  it("tells the transition which way a link goes before it navigates", async () => {
    const user = userEvent.setup();
    renderAt("/budgets", <Link to="/budgets/12">Courses</Link>);
    await user.click(screen.getByRole("link", { name: "Courses" }));
    expect(document.documentElement.dataset.vtDir).toBe("1");
  });

  it("does the same for a nav link going back up", async () => {
    const user = userEvent.setup();
    renderAt("/budgets/12", <NavLink to="/budgets">Budgets</NavLink>);
    await user.click(screen.getByRole("link", { name: "Budgets" }));
    expect(document.documentElement.dataset.vtDir).toBe("-1");
  });

  it("asks for no transition at all with motion off", async () => {
    useMotionPreference.setState({ disabled: true });
    const user = userEvent.setup();
    renderAt("/budgets", <Link to="/budgets/12">Courses</Link>);
    await user.click(screen.getByRole("link", { name: "Courses" }));
    expect(document.documentElement.dataset.vtDir).toBeUndefined();
  });

  it("still renders a NavLink's function children and class", () => {
    renderAt(
      "/budgets",
      <NavLink to="/budgets" className={({ isActive }) => (isActive ? "on" : "off")}>
        {({ isActive }) => (isActive ? "Actif" : "Inactif")}
      </NavLink>,
    );
    const link = screen.getByRole("link", { name: "Actif" });
    expect(link).toHaveClass("on");
  });
});
