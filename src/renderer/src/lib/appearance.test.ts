import { beforeEach, describe, expect, it } from "vitest";
import { getCustomColor, setCustomColor } from "./appearance";

const CUSTOM_KEY = "rs_custom_color";

describe("custom colour storage", () => {
  beforeEach(() => localStorage.clear());

  it("stores the validated colour normalised to lowercase", () => {
    setCustomColor("#FF0000");
    expect(localStorage.getItem(CUSTOM_KEY)).toBe("#ff0000");
    expect(getCustomColor()).toBe("#ff0000");
  });

  it("ignores a value that is not a hex colour", () => {
    setCustomColor("red;alert(1)");
    expect(localStorage.getItem(CUSTOM_KEY)).toBeNull();
  });

  it("falls back to the default when storage holds junk", () => {
    localStorage.setItem(CUSTOM_KEY, "not-a-colour");
    expect(getCustomColor()).toBe("#5b8def");
  });
});
