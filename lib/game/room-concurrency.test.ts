import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryRoomBackend,
  setRoomBackend,
  type RoomBackend,
} from "./room-repository";
import {
  createRoom,
  getRoom,
  joinRoom,
  sendChatMessage,
  startGame,
  submitAnswer,
} from "./room-store";
import { MAX_PLAYERS } from "./types";

/**
 * 운영에서 방 상태는 Supabase에 있으므로 읽기·쓰기마다 네트워크 왕복이 든다.
 * 인메모리 백엔드는 저장이 동기적으로 끝나 낙관적 락이 겹칠 틈이 거의 없어,
 * 지연을 끼워 실제 저장소와 같은 경합 조건을 만든다.
 */
function withLatency(base: RoomBackend, ms: number): RoomBackend {
  const wait = () => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    async load(code) {
      await wait();
      return base.load(code);
    },
    async insert(room) {
      await wait();
      return base.insert(room);
    },
    async saveIfUnchanged(room, expectedVersion) {
      await wait();
      return base.saveIfUnchanged(room, expectedVersion);
    },
    async listRecent(limit) {
      await wait();
      return base.listRecent(limit);
    },
  };
}

const LATENCY_MS = 5;

/** 지연 백엔드 위에 정원까지 채운 방을 만든다. */
async function makeFullRoom() {
  setRoomBackend(withLatency(createInMemoryRoomBackend(), LATENCY_MS));
  const { room, player } = await createRoom("방장");
  const playerIds = [player.id];

  for (let i = 1; i < MAX_PLAYERS; i += 1) {
    const joined = await joinRoom(room.code, `참가자${i}`);
    if ("error" in joined) throw new Error(joined.error);
    playerIds.push(joined.player.id);
  }

  return { code: room.code, playerIds };
}

/** 거부(정상 판정)와 예외(락 충돌)를 구분해 담는다. */
function settle<T>(promise: Promise<T>): Promise<T | Error> {
  return promise.then(
    (value) => value,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
}

afterEach(() => setRoomBackend(null));

describe("지연이 있는 저장소에서의 동시 쓰기", () => {
  it("4인이 동시에 채팅해도 메시지를 잃지 않는다", async () => {
    const { code, playerIds } = await makeFullRoom();

    const messages = playerIds.flatMap((id, playerIndex) =>
      Array.from({ length: 5 }, (_unused, i) => ({ id, text: `p${playerIndex}-m${i}` })),
    );

    const outcomes = await Promise.all(
      messages.map((m) => settle(sendChatMessage(code, m.id, m.text))),
    );

    // 재시도 백오프가 충돌을 흡수해야 하므로 예외로 떨어진 요청이 없어야 한다.
    expect(outcomes.filter((o) => o instanceof Error)).toEqual([]);

    const room = await getRoom(code);
    const stored = new Set(room?.chatMessages.map((m) => m.text));
    expect(messages.filter((m) => !stored.has(m.text))).toEqual([]);
  });

  it("정원까지 동시에 입장하면 모두 들어간다", async () => {
    setRoomBackend(withLatency(createInMemoryRoomBackend(), LATENCY_MS));
    const { room } = await createRoom("방장");

    const results = await Promise.all(
      Array.from({ length: MAX_PLAYERS - 1 }, (_unused, i) =>
        settle(joinRoom(room.code, `동시${i}`)),
      ),
    );

    expect(results.filter((r) => r instanceof Error)).toEqual([]);
    expect(results.filter((r) => !(r instanceof Error) && "error" in r)).toEqual([]);

    const loaded = await getRoom(room.code);
    expect(loaded?.players).toHaveLength(MAX_PLAYERS);
  });

  it("정원을 넘는 동시 입장은 락 충돌이 아니라 정원 초과로 거절한다", async () => {
    setRoomBackend(withLatency(createInMemoryRoomBackend(), LATENCY_MS));
    const { room } = await createRoom("방장");

    const results = await Promise.all(
      Array.from({ length: 8 }, (_unused, i) => settle(joinRoom(room.code, `초과${i}`))),
    );

    expect(results.filter((r) => r instanceof Error)).toEqual([]);

    const loaded = await getRoom(room.code);
    expect(loaded?.players).toHaveLength(MAX_PLAYERS);
  });

  it("동시 오답 제출이 낙관적 락 충돌로 실패하지 않는다", async () => {
    const { code, playerIds } = await makeFullRoom();
    const started = await startGame(code, playerIds[0], "사자성어", "medium");
    expect(started).not.toHaveProperty("error");

    const outcomes = await Promise.all(
      playerIds.flatMap((id) =>
        Array.from({ length: 4 }, (_unused, i) => settle(submitAnswer(code, id, `오답${i}`))),
      ),
    );

    expect(outcomes.filter((o) => o instanceof Error)).toEqual([]);
  });
});
