import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/leaderboard/route";
import { getRankedPage } from "./leaderboard";
import {
  createInMemoryLeaderboardBackend,
  setLeaderboardBackend,
} from "./leaderboard-repository";
import { wordsFor } from "./questions";
import { SINGLE_MODE_DURATION_MS } from "./types";

/**
 * 기록 제출 API의 입력 검증. 클라이언트가 보낸 값을 그대로 믿으면 조작된
 * 기록이 랭킹 상위를 차지하므로, 문제 수와 제한시간으로 상한을 확인한다.
 */
const ANIMAL_TOTAL = wordsFor("동물", "easy").length;

function submit(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

const validFullClear = {
  nickname: "정상기록",
  category: "동물",
  difficulty: "easy",
  clearedAll: true,
  elapsedMs: 20_000,
  clearedCount: ANIMAL_TOTAL,
};

beforeEach(() => {
  setLeaderboardBackend(createInMemoryLeaderboardBackend());
});

afterEach(() => {
  setLeaderboardBackend(null);
});

describe("기록 제출 입력 검증", () => {
  it("정상적인 전체 클리어 기록은 저장한다", async () => {
    const res = await submit(validFullClear);
    expect(res.status).toBe(200);
    expect((await getRankedPage(0)).totalCount).toBe(1);
  });

  it("클리어 개수가 카테고리 문제 수를 넘으면 거부한다", async () => {
    const res = await submit({ ...validFullClear, clearedCount: ANIMAL_TOTAL + 1 });
    expect(res.status).toBe(400);
    expect((await getRankedPage(0)).totalCount).toBe(0);
  });

  it("클리어 개수가 정수가 아니면 거부한다", async () => {
    const res = await submit({ ...validFullClear, clearedAll: false, clearedCount: 3.5 });
    expect(res.status).toBe(400);
  });

  it("클리어 시간이 제한시간을 넘으면 거부한다", async () => {
    const res = await submit({ ...validFullClear, elapsedMs: SINGLE_MODE_DURATION_MS + 1 });
    expect(res.status).toBe(400);
  });

  it("클리어 시간이 0 이하면 거부한다", async () => {
    expect((await submit({ ...validFullClear, elapsedMs: 0 })).status).toBe(400);
    expect((await submit({ ...validFullClear, elapsedMs: -5_000 })).status).toBe(400);
  });

  it("전체 클리어인데 클리어 개수가 문제 수와 다르면 거부한다", async () => {
    const res = await submit({ ...validFullClear, clearedCount: ANIMAL_TOTAL - 1 });
    expect(res.status).toBe(400);
  });

  it("중도 이탈 기록(0개)은 그대로 저장한다", async () => {
    const res = await submit({
      nickname: "중도이탈",
      category: "동물",
      difficulty: "easy",
      clearedAll: false,
      elapsedMs: null,
      clearedCount: 0,
    });
    expect(res.status).toBe(200);
    expect((await getRankedPage(0)).totalCount).toBe(1);
  });

  it("전체 클리어가 아닌 기록의 소요 시간은 저장하지 않는다", async () => {
    await submit({
      nickname: "부분클리어",
      category: "동물",
      difficulty: "easy",
      clearedAll: false,
      // 순위 기준에 쓰이지 않는 값이므로 보내도 무시돼야 한다.
      elapsedMs: 1,
      clearedCount: 2,
    });

    const [entry] = (await getRankedPage(0)).entries;
    expect(entry.clearedAll).toBe(false);
    expect(entry.elapsedMs).toBeNull();
  });
});
