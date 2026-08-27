import { describe, expect, it } from "vitest";
import { compareLeaderboardEntries, getTopEntries, submitLeaderboardResult } from "./leaderboard";
import type { LeaderboardEntry } from "./leaderboard";

function makeEntry(overrides: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    id: "id",
    nickname: "player",
    category: "사자성어",
    difficulty: "medium",
    clearedAll: false,
    elapsedMs: null,
    clearedCount: 0,
    createdAt: 0,
    ...overrides,
  };
}

describe("compareLeaderboardEntries", () => {
  it("ranks a full clear above a partial clear regardless of count", () => {
    const partial = makeEntry({ clearedAll: false, clearedCount: 9 });
    const full = makeEntry({ clearedAll: true, elapsedMs: 40_000, clearedCount: 10 });
    expect(compareLeaderboardEntries(full, partial)).toBeLessThan(0);
  });

  it("among full clears, ranks the faster elapsed time first", () => {
    const slow = makeEntry({ clearedAll: true, elapsedMs: 50_000 });
    const fast = makeEntry({ clearedAll: true, elapsedMs: 20_000 });
    expect(compareLeaderboardEntries(fast, slow)).toBeLessThan(0);
  });

  it("among partial clears, ranks the higher cleared count first", () => {
    const few = makeEntry({ clearedAll: false, clearedCount: 2 });
    const many = makeEntry({ clearedAll: false, clearedCount: 7 });
    expect(compareLeaderboardEntries(many, few)).toBeLessThan(0);
  });
});

describe("submitLeaderboardResult / getTopEntries", () => {
  it("returns submitted results ordered by rank, capped at the limit", () => {
    submitLeaderboardResult({
      nickname: "느림",
      category: "동물",
      difficulty: "easy",
      clearedAll: true,
      elapsedMs: 30_000,
      clearedCount: 8,
    });
    submitLeaderboardResult({
      nickname: "빠름",
      category: "동물",
      difficulty: "easy",
      clearedAll: true,
      elapsedMs: 15_000,
      clearedCount: 8,
    });

    const top = getTopEntries(1);
    expect(top).toHaveLength(1);
    expect(top[0].nickname).toBe("빠름");
  });
});
