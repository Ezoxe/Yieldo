import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { readDocumentTheme, useResolvedTheme } from "./useResolvedTheme";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("useResolvedTheme", () => {
  it("reads the theme the document is already painted in", () => {
    document.documentElement.dataset.theme = "light";
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
  });

  it("follows a change of preference", async () => {
    document.documentElement.dataset.theme = "dark";
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");

    await act(async () => {
      document.documentElement.dataset.theme = "light";
      // MutationObserver delivers on a microtask.
      await Promise.resolve();
    });
    expect(result.current).toBe("light");
  });

  it("falls back to dark when nothing has been stamped", () => {
    expect(readDocumentTheme()).toBe("dark");
  });
});
