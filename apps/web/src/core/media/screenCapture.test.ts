import { describe, expect, it } from "vitest";
import { isPickerDismissed } from "./screenCapture";

describe("isPickerDismissed", () => {
  it("treats cancelling the picker as a non-error", () => {
    expect(isPickerDismissed(new DOMException("x", "NotAllowedError"))).toBe(true);
    expect(isPickerDismissed(new DOMException("x", "AbortError"))).toBe(true);
  });
  it("still surfaces real failures", () => {
    expect(isPickerDismissed(new DOMException("x", "NotReadableError"))).toBe(false);
    expect(isPickerDismissed(new Error("boom"))).toBe(false);
  });
});
