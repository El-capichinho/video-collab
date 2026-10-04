import { describe, expect, it } from "vitest";
import { gridColumns } from "./layout";

describe("gridColumns", () => {
  it("scales from 1 to 6 participants", () => {
    expect([1, 2, 3, 4, 5, 6].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3]);
  });
});
