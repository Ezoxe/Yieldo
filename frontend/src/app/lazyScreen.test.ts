import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RELOADED_FLAG, loadOrReload } from "./lazyScreen";

describe("loadOrReload", () => {
  const reload = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns the module when the import works, and forgets any earlier reload", async () => {
    sessionStorage.setItem(RELOADED_FLAG, "1");
    const module = await loadOrReload(() => Promise.resolve({ Page: "x" }), reload);
    expect(module).toEqual({ Page: "x" });
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOADED_FLAG)).toBeNull();
  });

  it("reloads the page once when a chunk is gone after a deploy", async () => {
    // The browser kept the old index; its hashed chunks were replaced by
    // `install.sh update`. One reload fetches the new index and its chunks.
    const gone = new TypeError("error loading dynamically imported module: /assets/MandatePage-old.js");
    const pending = loadOrReload(() => Promise.reject(gone), reload);
    await expect(pending).rejects.toBe(gone);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOADED_FLAG)).toBe("1");
  });

  it("does not reload twice: a second failure is a real error, shown as such", async () => {
    sessionStorage.setItem(RELOADED_FLAG, "1");
    const gone = new TypeError("error loading dynamically imported module: /assets/x.js");
    await expect(loadOrReload(() => Promise.reject(gone), reload)).rejects.toBe(gone);
    expect(reload).not.toHaveBeenCalled();
  });
});
