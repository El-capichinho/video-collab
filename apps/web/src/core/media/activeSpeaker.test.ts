import { describe, expect, it } from "vitest";
import { pickActiveSpeaker, type SpeakerState } from "./activeSpeaker";

const none: SpeakerState = { id: null, lastLoudAt: 0 };

describe("pickActiveSpeaker", () => {
  it("highlights nobody in silence", () => {
    expect(pickActiveSpeaker({ a: 0.001, b: 0.0 }, none, 1000).id).toBeNull();
  });

  it("highlights the loudest person above the threshold", () => {
    expect(pickActiveSpeaker({ a: 0.05, b: 0.2, c: 0.01 }, none, 1000).id).toBe("b");
  });

  it("sticks with the current speaker unless someone is clearly louder", () => {
    const talking: SpeakerState = { id: "a", lastLoudAt: 1000 };
    expect(pickActiveSpeaker({ a: 0.1, b: 0.12 }, talking, 1100).id).toBe("a");
    expect(pickActiveSpeaker({ a: 0.1, b: 0.3 }, talking, 1100).id).toBe("b");
  });

  it("keeps the highlight briefly after they stop, then lets go", () => {
    const talking: SpeakerState = { id: "a", lastLoudAt: 1000 };
    expect(pickActiveSpeaker({ a: 0 }, talking, 1400).id).toBe("a");
    expect(pickActiveSpeaker({ a: 0 }, talking, 1800).id).toBeNull();
  });

  it("hands over immediately if the current speaker fell silent", () => {
    const talking: SpeakerState = { id: "a", lastLoudAt: 1000 };
    expect(pickActiveSpeaker({ a: 0.001, b: 0.05 }, talking, 1200).id).toBe("b");
  });
});
