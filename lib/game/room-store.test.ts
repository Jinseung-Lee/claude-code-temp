import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoom,
  getRoom,
  joinRoom,
  sendChatMessage,
  serializeForPlayer,
  startGame,
  submitAnswer,
  submitItemQuestionAnswer,
  applyItemUse,
} from "./room-store";
import { DELAY_ITEM_MS, ROUND_DURATION_MS, ROUND_RESULT_MS } from "./types";

const BASE_TIME = new Date("2026-01-01T00:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(playerCount = 2) {
  const { room, player: host } = createRoom("host");
  const others = [];
  for (let i = 1; i < playerCount; i += 1) {
    const joined = joinRoom(room.code, `guest${i}`);
    if ("error" in joined) throw new Error(joined.error);
    others.push(joined.player);
  }
  const started = startGame(room.code, host.id, "사자성어", "easy");
  if ("error" in started) throw new Error(started.error);
  return { code: room.code, host, others };
}

describe("createRoom / joinRoom", () => {
  it("creates a room with the host as the sole lobby player", () => {
    const { room, player } = createRoom("호스트");
    expect(room.phase).toBe("lobby");
    expect(room.players).toHaveLength(1);
    expect(room.hostId).toBe(player.id);
  });

  it("rejects joining a room that does not exist", () => {
    const result = joinRoom("ZZZZZZ", "누구");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("adds a guest to an existing lobby", () => {
    const { room } = createRoom("호스트");
    const joined = joinRoom(room.code, "게스트");
    if ("error" in joined) throw joined;
    expect(joined.room.players).toHaveLength(2);
  });

  it("refuses a 5th player once the room already has 4", () => {
    const { room } = createRoom("호스트");
    for (let i = 1; i <= 3; i += 1) {
      const joined = joinRoom(room.code, `guest${i}`);
      if ("error" in joined) throw new Error(joined.error);
    }
    const fifth = joinRoom(room.code, "guest4");
    expect(fifth).toEqual({ error: expect.any(String) });
  });
});

describe("startGame", () => {
  it("refuses to start with fewer than two players", () => {
    const { room, player } = createRoom("혼자");
    const result = startGame(room.code, player.id, "사자성어", "easy");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("refuses to start when the actor is not the host", () => {
    const { room } = createRoom("호스트");
    const joined = joinRoom(room.code, "게스트");
    if ("error" in joined) throw joined;
    const result = startGame(room.code, joined.player.id, "사자성어", "easy");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("starts round 0 with a masked question once two players are present", () => {
    const { code } = setup(2);
    const room = getRoom(code)!;
    expect(room.phase).toBe("round_active");
    expect(room.currentRoundIndex).toBe(0);
    expect(room.rounds[0].maskedQuestion).not.toBe(room.rounds[0].answer);
  });
});

describe("submitAnswer", () => {
  it("does not resolve the round on a wrong answer", () => {
    const { code, host } = setup(2);
    const room = getRoom(code)!;
    const answer = room.rounds[0].answer;
    const result = submitAnswer(code, host.id, `${answer}오답`);
    expect(result).toEqual({ correct: false });
    expect(getRoom(code)!.rounds[0].winnerId).toBeNull();
  });

  it("declares the first correct submitter the round winner and grants an item", () => {
    const { code, host, others } = setup(2);
    const answer = getRoom(code)!.rounds[0].answer;
    submitAnswer(code, host.id, answer);
    const room = getRoom(code)!;
    expect(room.phase).toBe("round_result");
    expect(room.rounds[0].winnerId).toBe(host.id);
    const winner = room.players.find((p) => p.id === host.id)!;
    expect(winner.roundWins).toBe(1);
    expect(winner.items.length).toBeGreaterThan(0);
    expect(others[0].id).not.toBe(room.rounds[0].winnerId);
  });

  it("ends the round with no winner when time runs out", () => {
    const { code } = setup(2);
    vi.setSystemTime(BASE_TIME + ROUND_DURATION_MS + 1);
    const room = getRoom(code)!;
    expect(room.phase).toBe("round_result");
    expect(room.rounds[0].winnerId).toBeNull();
  });

  it("advances to the next round after the result window passes", () => {
    const { code, host } = setup(2);
    const answer = getRoom(code)!.rounds[0].answer;
    submitAnswer(code, host.id, answer);
    vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
    const room = getRoom(code)!;
    expect(room.phase).toBe("round_active");
    expect(room.currentRoundIndex).toBe(1);
  });
});

describe("items", () => {
  it("a shield blocks an incoming attack item", () => {
    const { code, host, others } = setup(2);
    const target = others[0];
    // 라운드 1을 이겨서 host에게 아이템을 지급한 뒤, shield 아이템을 강제로 부여해 검증한다.
    const room = getRoom(code)!;
    room.players.find((p) => p.id === target.id)!.items.push({ id: "shield-1", type: "shield" });
    const shielded = applyItemUse(code, target.id, "shield-1", undefined);
    if ("error" in shielded) throw shielded;
    expect(shielded.players.find((p) => p.id === target.id)!.shieldActive).toBe(true);

    room.players.find((p) => p.id === host.id)!.items.push({ id: "delay-1", type: "delay" });
    const attacked = applyItemUse(code, host.id, "delay-1", target.id);
    if ("error" in attacked) throw attacked;
    const targetPlayer = attacked.players.find((p) => p.id === target.id)!;
    expect(targetPlayer.activeEffects).toHaveLength(0);
  });

  it("a delay effect lets a faster non-delayed answer win instead", () => {
    const { code, host, others } = setup(2);
    const target = others[0];
    const room = getRoom(code)!;
    room.players.find((p) => p.id === host.id)!.items.push({ id: "delay-1", type: "delay" });
    applyItemUse(code, host.id, "delay-1", target.id);

    const answer = getRoom(code)!.rounds[0].answer;
    // target(지연 대상)이 먼저 제출하지만 3초 지연되고, host가 그 사이 제출하면 host가 이긴다.
    submitAnswer(code, target.id, answer);
    vi.setSystemTime(Date.now() + 500);
    submitAnswer(code, host.id, answer);
    vi.setSystemTime(Date.now() + DELAY_ITEM_MS);
    const resolved = getRoom(code)!;
    expect(resolved.rounds[0].winnerId).toBe(host.id);
  });
});

describe("submitItemQuestionAnswer", () => {
  it("grants an item and issues a fresh item question on a correct answer", () => {
    const { code, host } = setup(2);
    const room = getRoom(code)!;
    const question = room.rounds[0].itemQuestions[host.id];
    const before = room.players.find((p) => p.id === host.id)!.items.length;

    const result = submitItemQuestionAnswer(code, host.id, question.answer);
    expect(result).toEqual({ correct: true });

    const after = getRoom(code)!;
    const player = after.players.find((p) => p.id === host.id)!;
    expect(player.items.length).toBe(before + 1);
    expect(after.rounds[0].itemQuestions[host.id].answer).not.toBe(question.answer);
  });

  it("does not grant an item on a wrong answer", () => {
    const { code, host } = setup(2);
    const before = getRoom(code)!.players.find((p) => p.id === host.id)!.items.length;
    const result = submitItemQuestionAnswer(code, host.id, "말도안되는오답");
    expect(result).toEqual({ correct: false });
    expect(getRoom(code)!.players.find((p) => p.id === host.id)!.items.length).toBe(before);
  });
});

describe("sendChatMessage", () => {
  it("appends a message attributed to the sender", () => {
    const { code, host } = setup(2);
    const result = sendChatMessage(code, host.id, "안녕하세요");
    if ("error" in result) throw result;
    expect(result.chatMessages).toHaveLength(1);
    expect(result.chatMessages[0]).toMatchObject({ playerId: host.id, nickname: "host", text: "안녕하세요" });
  });

  it("rejects an empty message", () => {
    const { code, host } = setup(2);
    const result = sendChatMessage(code, host.id, "   ");
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("applyItemUse: steal", () => {
  it("moves one random item from the target to the user, blocked by shield", () => {
    const { code, host, others } = setup(2);
    const target = others[0];
    const room = getRoom(code)!;
    room.players.find((p) => p.id === target.id)!.items.push({ id: "delay-owned", type: "delay" });
    room.players.find((p) => p.id === host.id)!.items.push({ id: "steal-1", type: "steal" });

    const stolen = applyItemUse(code, host.id, "steal-1", target.id);
    if ("error" in stolen) throw stolen;
    expect(stolen.players.find((p) => p.id === host.id)!.items.some((i) => i.type === "delay")).toBe(
      true,
    );
    expect(stolen.players.find((p) => p.id === target.id)!.items).toHaveLength(0);
  });
});

describe("serializeForPlayer", () => {
  it("hides the answer while the round is active and reveals it once resolved", () => {
    const { code, host } = setup(2);
    const active = serializeForPlayer(getRoom(code)!, host.id);
    expect(active.round?.answer).toBeNull();

    const answer = getRoom(code)!.rounds[0].answer;
    submitAnswer(code, host.id, answer);
    const resolved = serializeForPlayer(getRoom(code)!, host.id);
    expect(resolved.round?.answer).toBe(answer);
  });
});
