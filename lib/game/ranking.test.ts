import { describe, expect, it } from "vitest";
import { computeRanking, rankByScore } from "./ranking";
import type { Player } from "./types";

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: "p",
    nickname: "player",
    isHost: false,
    joinedAt: 0,
    roundWins: 0,
    correctRounds: 0,
    totalAnswerMs: 0,
    items: [],
    activeEffects: [],
    shieldActive: false,
    ...overrides,
  };
}

describe("computeRanking", () => {
  it("ranks by round wins descending", () => {
    const players = [
      makePlayer({ id: "a", roundWins: 2 }),
      makePlayer({ id: "b", roundWins: 5 }),
      makePlayer({ id: "c", roundWins: 3 }),
    ];
    const ranked = computeRanking(players);
    expect(ranked.map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties with faster average answer time", () => {
    const players = [
      makePlayer({ id: "slow", roundWins: 3, correctRounds: 3, totalAnswerMs: 30_000 }),
      makePlayer({ id: "fast", roundWins: 3, correctRounds: 3, totalAnswerMs: 9_000 }),
    ];
    const ranked = computeRanking(players);
    expect(ranked.map((p) => p.id)).toEqual(["fast", "slow"]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("puts a player with zero correct rounds behind one with a slow average", () => {
    const players = [
      makePlayer({ id: "never-won", roundWins: 0 }),
      makePlayer({ id: "won-once", roundWins: 0, correctRounds: 1, totalAnswerMs: 15_000 }),
    ];
    const ranked = computeRanking(players);
    expect(ranked.map((p) => p.id)).toEqual(["won-once", "never-won"]);
  });

  it("assigns the same rank to a genuine tie", () => {
    const players = [
      makePlayer({ id: "a", roundWins: 1 }),
      makePlayer({ id: "b", roundWins: 1 }),
      makePlayer({ id: "c", roundWins: 0 }),
    ];
    const ranked = computeRanking(players);
    const byId = Object.fromEntries(ranked.map((p) => [p.id, p.rank]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(1);
    expect(byId.c).toBe(3);
  });
});

describe("rankByScore", () => {
  it("ranks a minimal client-side shape the same way as computeRanking", () => {
    const entries = [
      { nickname: "느림", roundWins: 2, averageAnswerMs: 8000 },
      { nickname: "빠름", roundWins: 2, averageAnswerMs: 3000 },
      { nickname: "패배", roundWins: 0, averageAnswerMs: null },
    ];
    const ranked = rankByScore(entries);
    expect(ranked.map((p) => p.nickname)).toEqual(["빠름", "느림", "패배"]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });
});
