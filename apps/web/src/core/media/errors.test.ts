import { describe, expect, it } from "vitest";
import { describeMediaError } from "./errors";

describe("describeMediaError", () => {
  it("maps permission errors", () => {
    expect(describeMediaError(new DOMException("x", "NotAllowedError")).kind).toBe("denied");
  });
  it("maps missing devices", () => {
    expect(describeMediaError(new DOMException("x", "NotFoundError")).kind).toBe("no-device");
  });
  it("maps busy devices", () => {
    expect(describeMediaError(new DOMException("x", "NotReadableError")).kind).toBe("in-use");
  });
  it("falls back to unknown", () => {
    expect(describeMediaError(new Error("boom")).kind).toBe("unknown");
  });
});
