import { Outlet, ScrollRestoration } from "react-router";

/**
 * Above every route: the router's scroll restoration.
 *
 * Without it a navigation kept the window where it was — a phone reader three
 * screens down the dashboard tapped « Budgets » and landed three screens down
 * Budgets, above nothing they had asked for. A new screen now opens at its
 * top, and the back button returns to where the reader was.
 */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
