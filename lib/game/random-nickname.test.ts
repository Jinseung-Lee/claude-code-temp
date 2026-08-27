import { describe, expect, it } from "vitest";
import { generateRandomNickname } from "./random-nickname";

describe("generateRandomNickname", () => {
  it("stays within the 12-character nickname limit used by the join forms", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRandomNickname().length).toBeLessThanOrEqual(12);
    }
  });

  it("is non-empty and varies across calls", () => {
    const results = new Set(Array.from({ length: 20 }, () => generateRandomNickname()));
    expect(results.size).toBeGreaterThan(1);
    for (const nickname of results) expect(nickname.length).toBeGreaterThan(0);
  });
});
