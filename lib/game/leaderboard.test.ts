import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareLeaderboardEntries,
  getRankedPage,
  getTopEntries,
  rankEntries,
  submitLeaderboardResult,
} from "./leaderboard";
import type { LeaderboardEntry } from "./leaderboard";
import {
  createInMemoryLeaderboardBackend,
  setLeaderboardBackend,
} from "./leaderboard-repository";

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

describe("rankEntries", () => {
  it("gives identical scores the same rank", () => {
    const ranked = rankEntries([
      makeEntry({ id: "a", clearedAll: true, elapsedMs: 20_000 }),
      makeEntry({ id: "b", clearedAll: true, elapsedMs: 20_000 }),
      makeEntry({ id: "c", clearedAll: true, elapsedMs: 30_000 }),
    ]);

    expect(ranked.map((e) => e.rank)).toEqual([1, 1, 3]);
  });
});

describe("싱글모드 기록 저장", () => {
  beforeEach(() => {
    // 테스트마다 빈 저장소를 새로 끼워 기록이 서로 섞이지 않게 한다.
    setLeaderboardBackend(createInMemoryLeaderboardBackend());
  });

  afterEach(() => {
    setLeaderboardBackend(null);
  });

  it("TOP 10 한도를 넘는 순위여도 기록을 저장한다", async () => {
    for (let i = 0; i < 12; i += 1) {
      await submitLeaderboardResult({
        nickname: `기록${i}`,
        category: "동물",
        difficulty: "easy",
        clearedAll: true,
        elapsedMs: 10_000 + i * 1_000,
        clearedCount: 8,
      });
    }

    expect(await getTopEntries()).toHaveLength(10);
    const page = await getRankedPage(0);
    expect(page.totalCount).toBe(12);
    expect(page.entries).toHaveLength(12);
    expect(page.hasMore).toBe(false);
    expect(page.truncated).toBe(false);
  });

  it("클리어 개수가 0인 기록도 저장한다", async () => {
    const { rank, totalCount } = await submitLeaderboardResult({
      nickname: "중도이탈",
      category: "동물",
      difficulty: "easy",
      clearedAll: false,
      elapsedMs: null,
      clearedCount: 0,
    });

    expect(totalCount).toBe(1);
    expect(rank).toBe(1);
    expect((await getRankedPage(0)).totalCount).toBe(1);
  });

  it("저장한 기록의 전체 순위를 함께 돌려준다", async () => {
    await submitLeaderboardResult({
      nickname: "빠름",
      category: "동물",
      difficulty: "easy",
      clearedAll: true,
      elapsedMs: 15_000,
      clearedCount: 8,
    });
    const slow = await submitLeaderboardResult({
      nickname: "느림",
      category: "동물",
      difficulty: "easy",
      clearedAll: true,
      elapsedMs: 30_000,
      clearedCount: 8,
    });

    expect(slow.rank).toBe(2);
    expect(slow.totalCount).toBe(2);

    const top = await getTopEntries(1);
    expect(top).toHaveLength(1);
    expect(top[0].nickname).toBe("빠름");
  });
});

describe("getRankedPage", () => {
  beforeEach(() => {
    setLeaderboardBackend(createInMemoryLeaderboardBackend());
  });

  afterEach(() => {
    setLeaderboardBackend(null);
  });

  it("페이지를 나눠 돌려주고 순위 번호는 전체 기준으로 이어진다", async () => {
    for (let i = 0; i < 7; i += 1) {
      await submitLeaderboardResult({
        nickname: `기록${i}`,
        category: "동물",
        difficulty: "easy",
        clearedAll: true,
        elapsedMs: 10_000 + i * 1_000,
        clearedCount: 8,
      });
    }

    const first = await getRankedPage(0, 3);
    expect(first.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(first.hasMore).toBe(true);
    expect(first.totalCount).toBe(7);

    const second = await getRankedPage(1, 3);
    expect(second.entries.map((e) => e.rank)).toEqual([4, 5, 6]);
    expect(second.hasMore).toBe(true);

    const third = await getRankedPage(2, 3);
    expect(third.entries.map((e) => e.rank)).toEqual([7]);
    expect(third.hasMore).toBe(false);
  });

  it("범위를 벗어난 페이지는 빈 목록을 돌려준다", async () => {
    await submitLeaderboardResult({
      nickname: "하나",
      category: "동물",
      difficulty: "easy",
      clearedAll: false,
      elapsedMs: null,
      clearedCount: 3,
    });

    const page = await getRankedPage(9, 10);
    expect(page.entries).toEqual([]);
    expect(page.totalCount).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it("음수 페이지와 과도한 페이지 크기를 안전한 값으로 보정한다", async () => {
    await submitLeaderboardResult({
      nickname: "하나",
      category: "동물",
      difficulty: "easy",
      clearedAll: false,
      elapsedMs: null,
      clearedCount: 3,
    });

    const page = await getRankedPage(-5, 10_000);
    expect(page.page).toBe(0);
    expect(page.pageSize).toBeLessThanOrEqual(50);
    expect(page.entries).toHaveLength(1);
  });
});
