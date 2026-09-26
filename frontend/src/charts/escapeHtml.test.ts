import { describe, expect, it } from "vitest";

import { escapeHtml } from "./escapeHtml";

describe("escapeHtml", () => {
  it("neutralises the five characters HTML gives a meaning to", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
    );
  });

  it("leaves an ordinary French label exactly as it is", () => {
    expect(escapeHtml("Épargne et investissement — été 2026")).toBe(
      "Épargne et investissement — été 2026",
    );
  });

  it("returns the empty string for the empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});
