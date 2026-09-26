import { act } from "@testing-library/react";

/**
 * Lets whatever a screen asked for on mount land inside `act()`, before the
 * test ends.
 *
 * A component that fetches on mount answers after a synchronous test has
 * already returned; React then reports an update "not wrapped in act(...)".
 * One macrotask is enough for a stubbed `fetch`, which resolves on the
 * microtask queue. A test that awaits something the answer puts on screen
 * does not need this; it is for tests whose subject is visible before the
 * answer arrives.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
