import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRankedPage } from "./leaderboard";
import type { LeaderboardEntry } from "./leaderboard";
import { setLeaderboardBackend, type LeaderboardBackend } from "./leaderboard-repository";

/**
 * 순위 집계 상한(5000개)을 넘는 상황은 실제로 그만큼 기록을 넣어 확인하기
 * 어렵다. 상한 초과를 보고하는 백엔드를 끼워 `truncated`가 화면까지
 * 전달되는지만 검증한다.
 */
function makeEntry(i: number): LeaderboardEntry {
  return {
    id: `id-${i}`,
    nickname: `기록${i}`,
    category: "동물",
    difficulty: "easy",
    clearedAll: false,
    elapsedMs: null,
    clearedCount: i % 9,
    createdAt: i,
  };
}

const truncatingBackend: LeaderboardBackend = {
  async insert() {
    throw new Error("이 테스트에서는 저장하지 않는다");
  },
  async listAll() {
    return {
      entries: Array.from({ length: 120 }, (_, i) => makeEntry(i)),
      truncated: true,
    };
  },
};

beforeEach(() => {
  setLeaderboardBackend(truncatingBackend);
});

afterEach(() => {
  setLeaderboardBackend(null);
});

describe("순위 집계 상한 초과", () => {
  it("잘렸다는 사실을 페이지 결과로 알린다", async () => {
    const page = await getRankedPage(0);
    expect(page.truncated).toBe(true);
    expect(page.totalCount).toBe(120);
    expect(page.hasMore).toBe(true);
  });

  it("마지막 페이지에서도 잘림 표시가 유지된다", async () => {
    const last = await getRankedPage(2);
    expect(last.truncated).toBe(true);
    expect(last.hasMore).toBe(false);
  });
});
