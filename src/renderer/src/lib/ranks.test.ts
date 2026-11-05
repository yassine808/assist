import { describe, it, expect } from "vitest";
import { rankColor } from "./ranks";

/** The rank tint drives the emblem halo, breathing glow and hover ping. */
describe("rankColor", () => {
  it("keeps Immortal red", () => {
    for (const tier of [24, 25, 26]) expect(rankColor(tier)).toBe("#ff5f7a");
  });

  it("renders Radiant in white-gold", () => {
    expect(rankColor(27)).toBe("#ffe9b0");
  });

  it("leaves the lower tiers on their own colours", () => {
    expect(rankColor(0)).toBe("#7a7a85");
    expect(rankColor(3)).toBe("#9d9ea3");
    expect(rankColor(18)).toBe("#5b9bd5");
    expect(rankColor(21)).toBe("#e05cf5");
  });
});
