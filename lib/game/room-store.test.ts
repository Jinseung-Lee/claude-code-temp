import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoom,
  getRoom,
  getRoomView,
  joinRoom,
  leaveRoom,
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
  loadRoom,
  mutateRoom,
  setRoomBackend,
} from "./room-repository";
import {
  DELAY_ITEM_MS,
  ENDED_ROOM_RETENTION_MS,
  LOBBY_IDLE_TIMEOUT_MS,
  ROUND_DURATION_MS,
  ROUND_RESULT_MS,
  TOTAL_ROUNDS,
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
    let lastPhase = "";
    for (let i = 0; i < TOTAL_ROUNDS; i += 1) {
      const live = await getRoom(code);
      if (live?.phase !== "round_active") break;
      await submitAnswer(code, host.id, live.rounds[live.currentRoundIndex].answer);
      vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
      lastPhase = (await getRoom(code))?.phase ?? "";
    }
    // 마지막 라운드를 끝낸 조회가 finished를 돌려주고, 그 시점에 방이 지워진다.
    expect(lastPhase).toBe("finished");
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

describe("leaveRoom", () => {
  it("나간 참가자를 목록에서 제거한다", async () => {
    const { code, host, others } = await setup(3);

    const left = await leaveRoom(code, others[0].id);
    // 3명 중 1명이 나가도 게임은 이어지므로 방은 남는다.
    expect(left).toMatchObject({ ok: true, deleted: false });

    const room = await getRoom(code);
    expect(room!.players.map((p) => p.id)).toEqual([host.id, others[1].id]);
  });

  it("게임 중 1명만 남으면 즉시 종료하고 남은 1명이 승리한다", async () => {
    const { code, host, others } = await setup(2);

    const left = await leaveRoom(code, others[0].id);
    if ("error" in left) throw new Error(left.error);
    // 남은 사람이 결과를 볼 수 있어야 하므로 방은 아직 지워지지 않는다.
    expect(left.deleted).toBe(false);

    const room = (await getRoom(code))!;
    expect(room.phase).toBe("finished");
    expect(room.endReason).toBe("last_player_standing");

    const view = serializeForPlayer(room, host.id);
    expect(view.ranking).not.toBeNull();
    expect(view.ranking![0].id).toBe(host.id);
    expect(view.ranking![0].rank).toBe(1);
  });

  it("대기실에서 1명이 남아도 종료하지 않고 계속 기다린다", async () => {
    const { room } = await createRoom("호스트");
    const joined = await joinRoom(room.code, "손님");
    if ("error" in joined) throw new Error(joined.error);

    await leaveRoom(room.code, joined.player.id);

    const after = await getRoom(room.code);
    expect(after!.phase).toBe("lobby");
    expect(after!.players).toHaveLength(1);
  });

  it("방장이 나가면 가장 먼저 들어온 참가자가 새 방장이 된다", async () => {
    const { room, player: host } = await createRoom("호스트");
    const first = await joinRoom(room.code, "먼저");
    if ("error" in first) throw new Error(first.error);
    vi.setSystemTime(BASE_TIME + 1_000);
    const second = await joinRoom(room.code, "나중");
    if ("error" in second) throw new Error(second.error);

    await leaveRoom(room.code, host.id);

    const after = await getRoom(room.code);
    expect(after!.hostId).toBe(first.player.id);
    expect(after!.players.find((p) => p.id === first.player.id)!.isHost).toBe(true);
    expect(after!.players.find((p) => p.id === second.player.id)!.isHost).toBe(false);
  });

  it("모두 나간 방은 목록에서 사라진다", async () => {
    const { room, player: host } = await createRoom("호스트");

    await leaveRoom(room.code, host.id);

    expect(await listRooms()).toHaveLength(0);
  });

  it("참가자가 아닌 ID로 나가려 하면 거부한다", async () => {
    const { room } = await createRoom("호스트");
    expect(await leaveRoom(room.code, "없는-아이디")).toEqual({
      error: "이 방의 참가자가 아닙니다.",
    });
  });
});

describe("대기실 무응답 해체", () => {
  it("정해진 시간 동안 활동이 없으면 방을 해체한다", async () => {
    const { room, player: host } = await createRoom("호스트");
    const joined = await joinRoom(room.code, "손님");
    if ("error" in joined) throw new Error(joined.error);

    vi.setSystemTime(BASE_TIME + LOBBY_IDLE_TIMEOUT_MS);

    const after = await getRoom(room.code);
    expect(after!.phase).toBe("disbanded");
    expect(after!.endReason).toBe("idle_disbanded");
    expect(await listRooms()).toHaveLength(0);
    // 해체된 방은 참가자에게도 더 이상 조회되지 않는다.
    const view = await getRoomView(room.code, host.id);
    expect("error" in view && view.status).toBe(410);
  });

  it("채팅을 보내면 해체 시각이 뒤로 밀린다", async () => {
    const { room, player: host } = await createRoom("호스트");
    const joined = await joinRoom(room.code, "손님");
    if ("error" in joined) throw new Error(joined.error);

    // 해체 직전에 채팅을 보내 타이머를 되돌린다.
    vi.setSystemTime(BASE_TIME + LOBBY_IDLE_TIMEOUT_MS - 1_000);
    const sent = await sendChatMessage(room.code, host.id, "아직 있어요");
    expect("error" in sent).toBe(false);

    vi.setSystemTime(BASE_TIME + LOBBY_IDLE_TIMEOUT_MS + 1_000);
    const after = await getRoom(room.code);
    expect(after!.phase).toBe("lobby");
  });

  it("게임이 시작된 방은 무응답으로 해체하지 않는다", async () => {
    const { code } = await setup(2);

    vi.setSystemTime(BASE_TIME + LOBBY_IDLE_TIMEOUT_MS * 3);

    const after = await getRoom(code);
    expect(after!.phase).not.toBe("disbanded");
  });

  it("해체된 방에는 새로 들어갈 수 없다", async () => {
    const { room } = await createRoom("호스트");
    vi.setSystemTime(BASE_TIME + LOBBY_IDLE_TIMEOUT_MS);
    await getRoom(room.code); // 해체 처리를 확정한다

    expect(await joinRoom(room.code, "지각")).toEqual({ error: "해체된 방입니다." });
  });
});

describe("summarizeRoom: 방 목록 참가자", () => {
  it("대기 중인 방은 순위 없이 참가자를 담는다", async () => {
    const { room } = await createRoom("호스트");
    await joinRoom(room.code, "손님");

    const [summary] = await listRooms();
    expect(summary.players).toHaveLength(2);
    expect(summary.players[0]).toMatchObject({ nickname: "호스트", isHost: true, rank: null });
    expect(summary.players[1]).toMatchObject({ nickname: "손님", isHost: false, rank: null });
  });

  it("진행 중인 방은 참가자를 순위 순으로 담는다", async () => {
    const { code, others } = await setup(2);

    // guest1이 먼저 맞혀 1승을 만든다.
    const round = (await getRoom(code))!.rounds[0];
    await submitAnswer(code, others[0].id, round.answer);

    const [summary] = await listRooms();
    expect(summary.players[0]).toMatchObject({ nickname: "guest1", rank: 1, roundWins: 1 });
    expect(summary.players[1]).toMatchObject({ nickname: "host", rank: 2, roundWins: 0 });
  });
});

describe("종료된 방 삭제", () => {
  /** 마지막 라운드까지 시간을 흘려 10라운드를 모두 끝낸다. */
  async function playToFinish(code: string): Promise<void> {
    for (let round = 0; round < TOTAL_ROUNDS; round += 1) {
      vi.setSystemTime(Date.now() + ROUND_DURATION_MS + 1);
      await getRoom(code);
      vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
      await getRoom(code);
    }
  }

  it("10라운드가 끝난 방은 결과를 볼 시간이 지난 뒤에 지워진다", async () => {
    const { code } = await setup(2);

    await playToFinish(code);
    // 끝난 직후에는 최종 순위를 볼 수 있어야 하므로 남아 있다.
    expect(await loadRoom(code)).not.toBeNull();

    vi.setSystemTime(Date.now() + ENDED_ROOM_RETENTION_MS + 1);
    await getRoom(code);

    expect(await loadRoom(code)).toBeNull();
  });

  it("방을 지우는 조회에서도 최종 순위를 볼 수 있는 상태를 돌려준다", async () => {
    const { code, host } = await setup(2);
    for (let round = 0; round < TOTAL_ROUNDS - 1; round += 1) {
      vi.setSystemTime(Date.now() + ROUND_DURATION_MS + 1);
      await getRoom(code);
      vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
      await getRoom(code);
    }

    vi.setSystemTime(Date.now() + ROUND_DURATION_MS + 1);
    await getRoom(code);
    vi.setSystemTime(Date.now() + ROUND_RESULT_MS + 1);
    const finished = (await getRoom(code))!;

    // 끝난 직후 폴링에서 순위를 볼 수 있어야 한다.
    expect(finished.phase).toBe("finished");
    expect(serializeForPlayer(finished, host.id).ranking).not.toBeNull();
    expect(await loadRoom(code)).not.toBeNull();
  });

  it("게임 중 1명만 남아 종료되면 남은 사람이 결과를 볼 수 있게 남긴다", async () => {
    const { code, host, others } = await setup(2);

    const result = await leaveRoom(code, others[0].id);

    expect(result).toMatchObject({ ok: true, deleted: false });
    // 남은 사람의 폴링이 404가 아니라 1인 승리 결과를 받아야 한다.
    const view = await getRoomView(code, host.id);
    expect("view" in view && view.view.phase).toBe("finished");
    expect("view" in view && view.view.ranking?.[0]?.id).toBe(host.id);
  });

  it("1인 승리 종료도 보관 시간이 지나면 지워진다", async () => {
    const { code, others } = await setup(2);
    await leaveRoom(code, others[0].id);

    vi.setSystemTime(Date.now() + ENDED_ROOM_RETENTION_MS + 1);
    await getRoom(code);

    expect(await loadRoom(code)).toBeNull();
  });

  it("모두 나가 해체된 방은 사유를 알릴 수 있도록 잠시 남긴다", async () => {
    const { room, player: host } = await createRoom("혼자");

    const result = await leaveRoom(room.code, host.id);

    // 바로 지우면 "해체됨"과 "없는 방"을 구분할 수 없다.
    expect(result).toMatchObject({ ok: true, deleted: false });
    expect(await loadRoom(room.code)).not.toBeNull();
    expect((await getRoomView(room.code, host.id) as { status: number }).status).toBe(410);
  });

  it("전원 이탈과 무응답 해체를 서로 다른 사유로 알린다", async () => {
    const { room: left, player: soloHost } = await createRoom("혼자");
    await leaveRoom(left.code, soloHost.id);
    const leftView = await getRoomView(left.code, soloHost.id);
    expect("error" in leftView && leftView.error).toContain("모두 나가");

    const { room: idle, player: idleHost } = await createRoom("방치");
    vi.setSystemTime(BASE_TIME + LOBBY_IDLE_TIMEOUT_MS + 1);
    const idleView = await getRoomView(idle.code, idleHost.id);
    expect("error" in idleView && idleView.error).toContain("활동이 없어");
  });

  it("해체 후 보관 시간이 지나면 방을 지운다", async () => {
    const { room, player: host } = await createRoom("혼자");
    await leaveRoom(room.code, host.id);

    vi.setSystemTime(Date.now() + ENDED_ROOM_RETENTION_MS + 1);
    await getRoom(room.code);

    expect(await loadRoom(room.code)).toBeNull();
  });

  it("대기실 무응답 해체도 보관 시간이 지난 뒤에 지운다", async () => {
    const { room } = await createRoom("호스트");
    const joined = await joinRoom(room.code, "게스트");
    if ("error" in joined) throw joined;

    vi.setSystemTime(BASE_TIME + LOBBY_IDLE_TIMEOUT_MS + 1);
    const ticked = (await getRoom(room.code))!;
    expect(ticked.phase).toBe("disbanded");
    // 해체 직후에는 사유를 알려줄 수 있어야 하므로 아직 남아 있다.
    expect(await loadRoom(room.code)).not.toBeNull();

    vi.setSystemTime(Date.now() + ENDED_ROOM_RETENTION_MS + 1);
    await getRoom(room.code);
    expect(await loadRoom(room.code)).toBeNull();
  });

  it("게임이 계속되는 이탈에서는 방을 지우지 않는다", async () => {
    const { code, others } = await setup(3);

    const result = await leaveRoom(code, others[0].id);

    expect(result).toMatchObject({ ok: true, deleted: false });
    const reloaded = (await getRoom(code))!;
    expect(reloaded.phase).toBe("round_active");
    expect(reloaded.players).toHaveLength(2);
  });

  it("로비에 1명이 남는 이탈에서는 방을 지우지 않는다", async () => {
    const { room } = await createRoom("호스트");
    const joined = await joinRoom(room.code, "게스트");
    if ("error" in joined) throw joined;

    const result = await leaveRoom(room.code, joined.player.id);

    expect(result).toMatchObject({ ok: true, deleted: false });
    expect(await loadRoom(room.code)).not.toBeNull();
  });

  it("이미 지워진 방에 나가기를 보내도 오류가 아니다", async () => {
    const { code, others } = await setup(2);
    await leaveRoom(code, others[0].id);
    vi.setSystemTime(Date.now() + ENDED_ROOM_RETENTION_MS + 1);
    await getRoom(code); // 보관 시간이 지나 삭제된다
    expect(await loadRoom(code)).toBeNull();

    // 버튼 클릭과 페이지 종료 신호가 겹쳐 두 번 도착하는 상황이다.
    const again = await leaveRoom(code, others[0].id);

    expect(again).toMatchObject({ ok: true, deleted: true });
  });

  it("지워진 방은 목록에도 남지 않는다", async () => {
    const { code } = await setup(2);
    await playToFinish(code);

    const rooms = await listRooms();

    expect(rooms.map((r) => r.code)).not.toContain(code);
  });
});
