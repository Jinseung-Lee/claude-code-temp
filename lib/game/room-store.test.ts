import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoom,
  getRoom,
  joinRoom,
  listRooms,
  sendChatMessage,
  serializeForPlayer,
  startGame,
  submitAnswer,
  submitItemQuestionAnswer,
  applyItemUse,
} from "./room-store";
import {
  createInMemoryRoomBackend,
  isEphemeralStorageUnsafe,
  mutateRoom,
  setRoomBackend,
} from "./room-repository";
import {
  DELAY_ITEM_MS,
  ROUND_DURATION_MS,
  ROUND_RESULT_MS,
  type ItemType,
  type Room,
} from "./types";

const BASE_TIME = new Date("2026-01-01T00:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
  // DB 없이 저장·조회 경계를 그대로 통과시키는 인메모리 백엔드를 쓴다.
  setRoomBackend(createInMemoryRoomBackend());
});

afterEach(() => {
  vi.useRealTimers();
  setRoomBackend(null);
});

/** 방 상태를 직접 손보고 저장한다. 아이템을 강제로 지급할 때만 쓴다. */
async function editRoom(code: string, edit: (room: Room) => void): Promise<void> {
  const outcome = await mutateRoom(code, (room) => {
    edit(room);
    return { result: undefined, persist: true };
  });
  if (!outcome) throw new Error(`방을 찾지 못했습니다: ${code}`);
}

async function giveItem(
  code: string,
  playerId: string,
  itemId: string,
  type: ItemType,
): Promise<void> {
  await editRoom(code, (room) => {
    room.players.find((p) => p.id === playerId)!.items.push({ id: itemId, type });
  });
}

async function setup(playerCount = 2) {
  const { room, player: host } = await createRoom("host");
  const others = [];
  for (let i = 1; i < playerCount; i += 1) {
    const joined = await joinRoom(room.code, `guest${i}`);
    if ("error" in joined) throw new Error(joined.error);
    others.push(joined.player);
  }
  const started = await startGame(room.code, host.id, "사자성어", "easy");
  if ("error" in started) throw new Error(started.error);
  return { code: room.code, host, others };
}

describe("Supabase 설정이 없는 환경", () => {
  it("환경변수가 없어도 방을 만들고 이어서 읽을 수 있다", async () => {
    // 자동 선택 경로를 그대로 타게 하려고 주입한 백엔드를 치운다.
    setRoomBackend(null);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { room, player } = await createRoom("호스트");
    const reloaded = await getRoom(room.code);
    expect(reloaded?.code).toBe(room.code);
    expect(reloaded?.players[0].id).toBe(player.id);

    vi.unstubAllEnvs();
  });
});

describe("서버리스 인메모리 폴백 감지", () => {
  it("Vercel에서 Supabase 설정이 없으면 위험 상태로 본다", () => {
    setRoomBackend(null);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    expect(isEphemeralStorageUnsafe()).toBe(true);

    vi.unstubAllEnvs();
  });

  it("Supabase가 설정돼 있으면 위험 상태가 아니다", () => {
    setRoomBackend(null);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret");

    expect(isEphemeralStorageUnsafe()).toBe(false);

    vi.unstubAllEnvs();
  });

  it("Vercel이 아닌 환경(로컬 개발)에서는 폴백을 허용한다", () => {
    setRoomBackend(null);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    expect(isEphemeralStorageUnsafe()).toBe(false);

    vi.unstubAllEnvs();
  });
});

describe("ID 중복 방지", () => {
  it("이미 쓰이는 ID로는 참여할 수 없다", async () => {
    const { room } = await createRoom("초코");
    const result = await joinRoom(room.code, "초코");
    expect(result).toEqual({ error: "이미 사용 중인 ID입니다. 다른 ID를 만들어 주세요." });
  });

  it("대소문자와 공백만 다른 ID도 중복으로 본다", async () => {
    const { room } = await createRoom("Choco");
    const result = await joinRoom(room.code, "  choco ");
    expect("error" in result).toBe(true);
  });

  it("다른 ID로 다시 만들면 참여할 수 있다", async () => {
    const { room } = await createRoom("초코");
    const result = await joinRoom(room.code, "바닐라");
    expect("error" in result).toBe(false);
  });

  it("같은 playerId로 재입장할 때는 중복 검사를 하지 않는다", async () => {
    const { room, player } = await createRoom("초코");
    const rejoined = await joinRoom(room.code, "초코", player.id);
    expect("error" in rejoined).toBe(false);
    if ("error" in rejoined) throw new Error(rejoined.error);
    expect(rejoined.player.id).toBe(player.id);
  });
});

describe("createRoom / joinRoom", () => {
  it("creates a room with the host as the sole lobby player", async () => {
    const { room, player } = await createRoom("호스트");
    expect(room.phase).toBe("lobby");
    expect(room.players).toHaveLength(1);
    expect(room.hostId).toBe(player.id);
  });

  it("persists the room so a later read sees it", async () => {
    const { room } = await createRoom("호스트");
    const reloaded = await getRoom(room.code);
    expect(reloaded?.code).toBe(room.code);
  });

  it("rejects joining a room that does not exist", async () => {
    const result = await joinRoom("ZZZZZZ", "누구");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("adds a guest to an existing lobby", async () => {
    const { room } = await createRoom("호스트");
    const joined = await joinRoom(room.code, "게스트");
    if ("error" in joined) throw joined;
    expect(joined.room.players).toHaveLength(2);
  });

  it("refuses a 5th player once the room already has 4", async () => {
    const { room } = await createRoom("호스트");
    for (let i = 1; i <= 3; i += 1) {
      const joined = await joinRoom(room.code, `guest${i}`);
      if ("error" in joined) throw new Error(joined.error);
    }
    const fifth = await joinRoom(room.code, "guest4");
    expect(fifth).toEqual({ error: expect.any(String) });
  });

  it("lets a disconnected player rejoin mid-game with their existing id", async () => {
    const { code, others } = await setup(2);
    const rejoined = await joinRoom(code, "게스트", others[0].id);
    if ("error" in rejoined) throw rejoined;
    expect(rejoined.player.id).toBe(others[0].id);
    expect(rejoined.room.players).toHaveLength(2);
  });

  it("still refuses a brand-new player once the game has started", async () => {
    const { code } = await setup(2);
    const result = await joinRoom(code, "늦은사람");
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("startGame", () => {
  it("refuses to start with fewer than two players", async () => {
    const { room, player } = await createRoom("혼자");
    const result = await startGame(room.code, player.id, "사자성어", "easy");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("refuses to start when the actor is not the host", async () => {
    const { room } = await createRoom("호스트");
    const joined = await joinRoom(room.code, "게스트");
    if ("error" in joined) throw joined;
    const result = await startGame(room.code, joined.player.id, "사자성어", "easy");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("starts round 0 with a masked question once two players are present", async () => {
    const { code } = await setup(2);
    const room = (await getRoom(code))!;
    expect(room.phase).toBe("round_active");
    expect(room.currentRoundIndex).toBe(0);
    expect(room.rounds[0].maskedQuestion).not.toBe(room.rounds[0].answer);
  });
});

describe("submitAnswer", () => {
  it("does not resolve the round on a wrong answer", async () => {
    const { code, host } = await setup(2);
    const room = (await getRoom(code))!;
    const answer = room.rounds[0].answer;
    const result = await submitAnswer(code, host.id, `${answer}오답`);
    expect(result).toEqual({ correct: false });
    expect((await getRoom(code))!.rounds[0].winnerId).toBeNull();
  });

  it("declares the first correct submitter the round winner and grants an item", async () => {
    const { code, host, others } = await setup(2);
    const answer = (await getRoom(code))!.rounds[0].answer;
    await submitAnswer(code, host.id, answer);
    const room = (await getRoom(code))!;
    expect(room.phase).toBe("round_result");
    expect(room.rounds[0].winnerId).toBe(host.id);
    const winner = room.players.find((p) => p.id === host.id)!;
    expect(winner.roundWins).toBe(1);
    expect(winner.items.length).toBeGreaterThan(0);
    expect(others[0].id).not.toBe(room.rounds[0].winnerId);
  });

  it("ends the round with no winner when time runs out", async () => {
    const { code } = await setup(2);
    vi.setSystemTime(BASE_TIME + ROUND_DURATION_MS + 1);
    const room = (await getRoom(code))!;
    expect(room.phase).toBe("round_result");
    expect(room.rounds[0].winnerId).toBeNull();
  });

  it("advances to the next round after the result window passes", async () => {
    const { code, host } = await setup(2);
    const answer = (await getRoom(code))!.rounds[0].answer;
    await submitAnswer(code, host.id, answer);
    vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
    const room = (await getRoom(code))!;
    expect(room.phase).toBe("round_active");
    expect(room.currentRoundIndex).toBe(1);
  });

  it("keeps the advanced round on a subsequent read", async () => {
    const { code, host } = await setup(2);
    const answer = (await getRoom(code))!.rounds[0].answer;
    await submitAnswer(code, host.id, answer);
    vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
    await getRoom(code);
    // 라운드 진행이 저장됐다면 다시 읽어도 그대로 남아 있어야 한다.
    const room = (await getRoom(code))!;
    expect(room.currentRoundIndex).toBe(1);
    expect(room.rounds).toHaveLength(2);
  });
});

describe("items", () => {
  it("a shield blocks an incoming attack item", async () => {
    const { code, host, others } = await setup(2);
    const target = others[0];
    await giveItem(code, target.id, "shield-1", "shield");
    const shielded = await applyItemUse(code, target.id, "shield-1", undefined);
    if ("error" in shielded) throw shielded;
    expect(shielded.players.find((p) => p.id === target.id)!.shieldActive).toBe(true);

    await giveItem(code, host.id, "delay-1", "delay");
    const attacked = await applyItemUse(code, host.id, "delay-1", target.id);
    if ("error" in attacked) throw attacked;
    const targetPlayer = attacked.players.find((p) => p.id === target.id)!;
    expect(targetPlayer.activeEffects).toHaveLength(0);
  });

  it("a delay effect lets a faster non-delayed answer win instead", async () => {
    const { code, host, others } = await setup(2);
    const target = others[0];
    await giveItem(code, host.id, "delay-1", "delay");
    await applyItemUse(code, host.id, "delay-1", target.id);

    const answer = (await getRoom(code))!.rounds[0].answer;
    // target(지연 대상)이 먼저 제출하지만 3초 지연되고, host가 그 사이 제출하면 host가 이긴다.
    await submitAnswer(code, target.id, answer);
    vi.setSystemTime(Date.now() + 500);
    await submitAnswer(code, host.id, answer);
    vi.setSystemTime(Date.now() + DELAY_ITEM_MS);
    const resolved = (await getRoom(code))!;
    expect(resolved.rounds[0].winnerId).toBe(host.id);
  });
});

describe("submitItemQuestionAnswer", () => {
  it("grants an item and issues a fresh item question on a correct answer", async () => {
    const { code, host } = await setup(2);
    const room = (await getRoom(code))!;
    const question = room.rounds[0].itemQuestions[host.id];
    const before = room.players.find((p) => p.id === host.id)!.items.length;

    const result = await submitItemQuestionAnswer(code, host.id, question.answer);
    expect(result).toEqual({ correct: true });

    const after = (await getRoom(code))!;
    const player = after.players.find((p) => p.id === host.id)!;
    expect(player.items.length).toBe(before + 1);
    expect(after.rounds[0].itemQuestions[host.id].answer).not.toBe(question.answer);
  });

  it("does not grant an item on a wrong answer", async () => {
    const { code, host } = await setup(2);
    const before = (await getRoom(code))!.players.find((p) => p.id === host.id)!.items.length;
    const result = await submitItemQuestionAnswer(code, host.id, "말도안되는오답");
    expect(result).toEqual({ correct: false });
    expect((await getRoom(code))!.players.find((p) => p.id === host.id)!.items.length).toBe(before);
  });
});

describe("sendChatMessage", () => {
  it("appends a message attributed to the sender", async () => {
    const { code, host } = await setup(2);
    const result = await sendChatMessage(code, host.id, "안녕하세요");
    if ("error" in result) throw result;
    expect(result.chatMessages).toHaveLength(1);
    expect(result.chatMessages[0]).toMatchObject({
      playerId: host.id,
      nickname: "host",
      text: "안녕하세요",
    });
  });

  it("rejects an empty message", async () => {
    const { code, host } = await setup(2);
    const result = await sendChatMessage(code, host.id, "   ");
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("applyItemUse: steal", () => {
  it("moves one random item from the target to the user, blocked by shield", async () => {
    const { code, host, others } = await setup(2);
    const target = others[0];
    await giveItem(code, target.id, "delay-owned", "delay");
    await giveItem(code, host.id, "steal-1", "steal");

    const stolen = await applyItemUse(code, host.id, "steal-1", target.id);
    if ("error" in stolen) throw stolen;
    expect(stolen.players.find((p) => p.id === host.id)!.items.some((i) => i.type === "delay")).toBe(
      true,
    );
    expect(stolen.players.find((p) => p.id === target.id)!.items).toHaveLength(0);
  });
});

describe("serializeForPlayer", () => {
  it("hides the answer while the round is active and reveals it once resolved", async () => {
    const { code, host } = await setup(2);
    const active = serializeForPlayer((await getRoom(code))!, host.id);
    expect(active.round?.answer).toBeNull();

    const answer = (await getRoom(code))!.rounds[0].answer;
    await submitAnswer(code, host.id, answer);
    const resolved = serializeForPlayer((await getRoom(code))!, host.id);
    expect(resolved.round?.answer).toBe(answer);
  });
});

describe("listRooms", () => {
  it("만들어진 방을 목록에 보여준다", async () => {
    const { room } = await createRoom("호스트");
    const rooms = await listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      code: room.code,
      hostNickname: "호스트",
      phase: "lobby",
      playerCount: 1,
      joinable: true,
    });
  });

  it("진행 중인 방도 보여주지만 들어갈 수 없다고 표시한다", async () => {
    const { code } = await setup(2);
    const rooms = await listRooms();
    const found = rooms.find((r) => r.code === code)!;
    expect(found.phase).toBe("round_active");
    expect(found.joinable).toBe(false);
  });

  it("인원이 가득 찬 로비는 들어갈 수 없다고 표시한다", async () => {
    const { room } = await createRoom("호스트");
    for (let i = 1; i <= 3; i += 1) {
      const joined = await joinRoom(room.code, `guest${i}`);
      if ("error" in joined) throw new Error(joined.error);
    }
    const found = (await listRooms()).find((r) => r.code === room.code)!;
    expect(found.playerCount).toBe(4);
    expect(found.joinable).toBe(false);
  });

  it("끝난 방은 목록에서 제외한다", async () => {
    const { code, host } = await setup(2);
    // 10라운드를 모두 소진해 finished로 만든다.
    for (let i = 0; i < 10; i += 1) {
      const live = await getRoom(code);
      if (live?.phase !== "round_active") break;
      await submitAnswer(code, host.id, live.rounds[live.currentRoundIndex].answer);
      vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
      await getRoom(code);
    }
    expect((await getRoom(code))!.phase).toBe("finished");
    expect((await listRooms()).some((r) => r.code === code)).toBe(false);
  });

  it("들어갈 수 있는 방을 앞에 둔다", async () => {
    // 먼저 대기 방을 만들고, 그 뒤에 진행 중인 방을 만든다. 최신순만
    // 따르면 진행 중인 방이 앞에 오므로 joinable 정렬이 실제로 검증된다.
    const open = await createRoom("먼저만든대기방");
    vi.setSystemTime(Date.now() + 1000);
    const started = await setup(2);

    const rooms = await listRooms();
    expect(rooms.map((r) => r.code)).toEqual([open.room.code, started.code]);
    expect(rooms[0].joinable).toBe(true);
    expect(rooms[1].joinable).toBe(false);
  });

  it("정답이나 진행 정보를 목록에 담지 않는다", async () => {
    const { code } = await setup(2);
    const live = await getRoom(code);
    const answer = live!.rounds[0].answer;

    const serialized = JSON.stringify(await listRooms());
    expect(serialized).not.toContain(answer);
    expect(serialized).not.toContain("itemQuestions");
    expect(serialized).not.toContain("rounds");
  });
});
