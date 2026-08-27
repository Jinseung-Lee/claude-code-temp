import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supabase 경로(운영 환경) 검증. 실제 postgrest 응답 형태를 흉내낸
 * 가짜 클라이언트를 @supabase/supabase-js에 끼워, room-repository의
 * Supabase 백엔드가 실제로 도는지 확인한다.
 */

interface Row {
  code: string;
  state: unknown;
  version: number;
}

const rows = new Map<string, Row>();

/** postgrest 쿼리 빌더를 흉내낸다. 필터를 모아 두고 마지막에 적용한다. */
function makeQuery(table: string, op: "select" | "insert" | "update", payload?: Record<string, unknown>) {
  const filters: Array<[string, unknown]> = [];

  const applyFilters = (list: Row[]) =>
    list.filter((r) => filters.every(([col, val]) => (r as unknown as Record<string, unknown>)[col] === val));

  const builder: Record<string, unknown> = {
    eq(col: string, val: unknown) {
      filters.push([col, val]);
      return builder;
    },
    select() {
      // update().select() 형태
      return builder;
    },
    async maybeSingle() {
      if (table !== "game_rooms") return { data: null, error: { message: `unknown table ${table}` } };
      const matched = applyFilters([...rows.values()]);
      if (matched.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: matched[0] ?? null, error: null };
    },
    then(resolve: (v: unknown) => unknown) {
      // await 시 동작 (update().select() 후 배열 반환)
      if (op === "insert") {
        const code = payload!.code as string;
        if (rows.has(code)) {
          return Promise.resolve({ data: null, error: { message: "duplicate key" } }).then(resolve);
        }
        rows.set(code, payload as unknown as Row);
        return Promise.resolve({ data: [payload], error: null }).then(resolve);
      }
      if (op === "update") {
        const matched = applyFilters([...rows.values()]);
        matched.forEach((r) => rows.set(r.code, { ...r, ...(payload as object) } as Row));
        return Promise.resolve({ data: matched.map((r) => ({ code: r.code })), error: null }).then(resolve);
      }
      return Promise.resolve({ data: applyFilters([...rows.values()]), error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => makeQuery(table, "select"),
      insert: (payload: Record<string, unknown>) => makeQuery(table, "insert", payload),
      update: (payload: Record<string, unknown>) => makeQuery(table, "update", payload),
    }),
  }),
}));

beforeEach(() => {
  rows.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime());
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
});

describe("Supabase 백엔드 경로", () => {
  it("생성 → 참가 → 시작 → 정답 → 라운드 진행이 DB를 통해 동작한다", async () => {
    const { createRoom, joinRoom, startGame, submitAnswer, getRoom } = await import("./room-store");
    const { setRoomBackend } = await import("./room-repository");
    setRoomBackend(null); // 자동 선택 → Supabase 경로

    const { room, player: host } = await createRoom("호스트");
    expect(rows.size).toBe(1);
    expect(rows.get(room.code)!.version).toBe(1);

    const joined = await joinRoom(room.code, "게스트");
    if ("error" in joined) throw new Error(joined.error);
    expect(rows.get(room.code)!.version).toBe(2);

    const started = await startGame(room.code, host.id, "사자성어", "easy");
    expect(started).not.toHaveProperty("error");

    const live = await getRoom(room.code);
    expect(live!.phase).toBe("round_active");

    const answer = live!.rounds[0].answer;
    const result = await submitAnswer(room.code, host.id, answer);
    expect(result).toEqual({ correct: true });

    const after = await getRoom(room.code);
    expect(after!.rounds[0].winnerId).toBe(host.id);
  });

  it("소문자 방 코드로 조회해도 같은 방을 찾는다", async () => {
    const { createRoom, getRoom } = await import("./room-store");
    const { setRoomBackend } = await import("./room-repository");
    setRoomBackend(null);

    const { room } = await createRoom("호스트");
    const found = await getRoom(room.code.toLowerCase());
    expect(found?.code).toBe(room.code);
  });

  it("코드가 이미 쓰이고 있으면 예외 없이 다른 코드로 다시 시도한다", async () => {
    const { createRoom } = await import("./room-store");
    const { setRoomBackend, createInMemoryRoomBackend } = await import("./room-repository");

    // 첫 insert만 중복으로 거절하는 백엔드를 끼워 재시도 경로를 강제한다.
    const inner = createInMemoryRoomBackend();
    let rejectedOnce = false;
    setRoomBackend({
      ...inner,
      async insert(room) {
        if (!rejectedOnce) {
          rejectedOnce = true;
          return false;
        }
        return inner.insert(room);
      },
    });

    const { room, player } = await createRoom("호스트");
    expect(rejectedOnce).toBe(true);

    // 재시도가 없으면 거절된 방이 저장되지 않은 채 반환되어 이 조회가 비게 된다.
    const stored = await inner.load(room.code);
    expect(stored).not.toBeNull();
    expect(stored!.room.players[0].id).toBe(player.id);

    setRoomBackend(null);
  });

  it("존재하지 않는 방은 undefined를 돌려준다", async () => {
    const { getRoom } = await import("./room-store");
    const { setRoomBackend } = await import("./room-repository");
    setRoomBackend(null);

    expect(await getRoom("ZZZZZZ")).toBeUndefined();
  });
});
