import { describe, expect, it } from "vitest";
import { ALL_ITEM_TYPES, drawRandomItemType } from "./items";

describe("drawRandomItemType", () => {
  it("picks the first item type when rng returns 0", () => {
    expect(drawRandomItemType(() => 0)).toBe(ALL_ITEM_TYPES[0]);
  });

  it("picks the last item type when rng returns just under 1", () => {
    expect(drawRandomItemType(() => 0.9999)).toBe(ALL_ITEM_TYPES[ALL_ITEM_TYPES.length - 1]);
  });

  it("always returns a defined item type across the full range", () => {
    for (let i = 0; i < 100; i += 1) {
      const value = i / 100;
      expect(ALL_ITEM_TYPES).toContain(drawRandomItemType(() => value));
    }
  });
});
