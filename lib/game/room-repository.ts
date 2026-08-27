import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Room } from "./types";

/**
 * 방 상태를 프로세스 메모리가 아니라 Supabase에 저장한다. 서버가 재시작되거나
 * 요청이 다른 인스턴스로 가더라도 진행 중인 방이 사라지지 않게 하는 것이 목적이다.
 *
 * 익명 참가자가 쓰는 리소스이므로 인증 세션이 없다. 따라서 쿠키 기반
 * `lib/server.ts` 클라이언트가 아니라 secret key로 만든 서버 전용 클라이언트를 쓴다.
 */

export const ROOMS_TABLE = "game_rooms";

/** 낙관적 락 충돌 시 재시도 횟수. 4인 방의 동시 요청 정도는 충분히 흡수한다. */
const MAX_WRITE_ATTEMPTS = 5;

export class RoomVersionConflictError extends Error {
  constructor() {
    super("방 상태가 동시에 변경되었습니다. 다시 시도해 주세요.");
    this.name = "RoomVersionConflictError";
  }
}

export interface LoadedRoom {
  room: Room;
  version: number;
}

/**
 * 저장소 백엔드. 운영에서는 Supabase 구현이 쓰이고, 테스트는 인메모리
 * 구현을 주입해 DB 없이 게임 로직을 검증한다.
 */
export interface RoomBackend {
  load(code: string): Promise<LoadedRoom | null>;
  insert(room: Room): Promise<void>;
  exists(code: string): Promise<boolean>;
  /** version이 기대값과 같을 때만 저장한다. 저장했으면 true. */
  saveIfUnchanged(room: Room, expectedVersion: number): Promise<boolean>;
}

interface RoomRow {
  code: string;
  state: Room;
  version: number;
}

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "방 상태 저장에는 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY 환경변수가 필요합니다.",
    );
  }

  cachedClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

const supabaseBackend: RoomBackend = {
  async load(code) {
    const { data, error } = await getClient()
      .from(ROOMS_TABLE)
      .select("code, state, version")
      .eq("code", code.toUpperCase())
      .maybeSingle<RoomRow>();

    if (error) throw new Error(`방 조회에 실패했습니다: ${error.message}`);
    if (!data) return null;
    return { room: data.state, version: data.version };
  },

  async insert(room) {
    const { error } = await getClient()
      .from(ROOMS_TABLE)
      .insert({ code: room.code, state: room, version: 1 });

    if (error) throw new Error(`방 생성에 실패했습니다: ${error.message}`);
  },

  async exists(code) {
    const { data, error } = await getClient()
      .from(ROOMS_TABLE)
      .select("code")
      .eq("code", code.toUpperCase())
      .maybeSingle<{ code: string }>();

    if (error) throw new Error(`방 코드 확인에 실패했습니다: ${error.message}`);
    return data !== null;
  },

  async saveIfUnchanged(room, expectedVersion) {
    const { data, error } = await getClient()
      .from(ROOMS_TABLE)
      .update({
        state: room,
        version: expectedVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("code", room.code)
      .eq("version", expectedVersion)
      .select("code");

    if (error) throw new Error(`방 저장에 실패했습니다: ${error.message}`);
    return (data?.length ?? 0) > 0;
  },
};

/**
 * DB 없이 방 로직을 검증할 때 쓰는 인메모리 백엔드. 저장 시 깊은 복사를
 * 하므로 실제 직렬화 경계와 같은 방식으로 동작한다.
 */
export function createInMemoryRoomBackend(): RoomBackend {
  const rows = new Map<string, { state: Room; version: number }>();
  const clone = (room: Room): Room => JSON.parse(JSON.stringify(room)) as Room;

  return {
    async load(code) {
      const row = rows.get(code.toUpperCase());
      if (!row) return null;
      return { room: clone(row.state), version: row.version };
    },
    async insert(room) {
      rows.set(room.code, { state: clone(room), version: 1 });
    },
    async exists(code) {
      return rows.has(code.toUpperCase());
    },
    async saveIfUnchanged(room, expectedVersion) {
      const row = rows.get(room.code);
      if (!row || row.version !== expectedVersion) return false;
      rows.set(room.code, { state: clone(room), version: expectedVersion + 1 });
      return true;
    },
  };
}

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/**
 * Supabase 설정이 없을 때 쓰는 인메모리 백엔드는 globalThis에 캐싱한다.
 * 모듈이 재평가되는(개발 중 HMR 등) 경우에도 같은 저장소를 계속 쓰게 해서
 * 방이 불필요하게 사라지는 일을 줄인다.
 */
const FALLBACK_KEY = "__chosungFallbackRoomBackend";

function getFallbackBackend(): RoomBackend {
  const globalScope = globalThis as typeof globalThis & {
    [FALLBACK_KEY]?: RoomBackend;
  };
  globalScope[FALLBACK_KEY] ??= createInMemoryRoomBackend();
  return globalScope[FALLBACK_KEY];
}

let warnedAboutFallback = false;

/**
 * 실제로 쓸 백엔드를 고른다. Supabase 설정이 있으면 그쪽에 저장해 서버
 * 재시작이나 인스턴스 교체에도 방이 살아남는다. 설정이 없으면 예외를
 * 던지는 대신 인메모리로 떨어뜨려, 환경변수를 채우지 않은 환경에서도
 * 게임이 그대로 동작하게 한다.
 */
function resolveBackend(): RoomBackend {
  if (injectedBackend) return injectedBackend;
  if (isSupabaseConfigured()) return supabaseBackend;

  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[room-store] Supabase 설정이 없어 방 상태를 메모리에 보관합니다. " +
        "서버가 재시작되거나 인스턴스가 여러 개면 진행 중인 방이 사라질 수 있습니다. " +
        "NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY를 설정하면 영속 저장으로 전환됩니다.",
    );
  }
  return getFallbackBackend();
}

let injectedBackend: RoomBackend | null = null;

/** 테스트에서 백엔드를 직접 끼우기 위한 훅. null이면 자동 선택으로 되돌린다. */
export function setRoomBackend(next: RoomBackend | null): void {
  injectedBackend = next;
}

export async function loadRoom(code: string): Promise<LoadedRoom | null> {
  return resolveBackend().load(code);
}

export async function insertRoom(room: Room): Promise<void> {
  return resolveBackend().insert(room);
}

/** 코드 중복 여부만 확인한다. 방 코드를 새로 뽑을 때 충돌을 피하는 데 쓴다. */
export async function roomCodeExists(code: string): Promise<boolean> {
  return resolveBackend().exists(code);
}

/**
 * 방을 읽어 `mutate`를 적용하고 낙관적 락으로 저장한다. `mutate`가 방을
 * 바꾸지 않는 조회성 작업이면 `persist: false`를 돌려 쓰기를 건너뛴다.
 *
 * `mutate`는 충돌 시 다시 실행되므로 방 상태 밖으로 나가는 부수효과를
 * 넣어서는 안 된다.
 */
export async function mutateRoom<T>(
  code: string,
  mutate: (room: Room) => { result: T; persist: boolean },
): Promise<{ room: Room; result: T } | null> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const active = resolveBackend();
    const loaded = await active.load(code);
    if (!loaded) return null;

    const { result, persist } = mutate(loaded.room);
    if (!persist) return { room: loaded.room, result };

    const saved = await active.saveIfUnchanged(loaded.room, loaded.version);
    if (saved) return { room: loaded.room, result };
  }

  throw new RoomVersionConflictError();
}
