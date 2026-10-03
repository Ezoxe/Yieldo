import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installInvalidShake } from "./invalidShake";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

let uninstall: () => void;
let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  animate = vi.fn();
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
  document.documentElement.dataset.motion = "on";
  uninstall = installInvalidShake();
});

afterEach(() => {
  uninstall();
  document.body.innerHTML = "";
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

function form(): { form: HTMLFormElement; bad: HTMLInputElement; good: HTMLInputElement } {
  document.body.innerHTML = `
    <form>
      <input id="good" />
      <input id="bad" aria-invalid="true" />
    </form>`;
  return {
    form: document.querySelector("form")!,
    bad: document.querySelector<HTMLInputElement>("#bad")!,
    good: document.querySelector<HTMLInputElement>("#good")!,
  };
}

describe("installInvalidShake", () => {
  // The field the form refused shakes once, right after the reader pressed
  // « Enregistrer »: the eye goes to what needs changing.
  it("shakes the fields a submitted form marked invalid, and only those", async () => {
    const { form: element, bad } = form();
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await nextFrame();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.instances[0]).toBe(bad);
  });

  it("keeps still under the motion switch", async () => {
    document.documentElement.dataset.motion = "off";
    const { form: element } = form();
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await nextFrame();
    expect(animate).not.toHaveBeenCalled();
  });

  // Typing never shakes anything: a field that turns invalid under the
  // reader's fingers is told so by its message, not by a jolt.
  it("does nothing outside a submission", async () => {
    const { bad } = form();
    bad.setAttribute("aria-invalid", "true");
    bad.dispatchEvent(new Event("input", { bubbles: true }));
    await nextFrame();
    expect(animate).not.toHaveBeenCalled();
  });
});
