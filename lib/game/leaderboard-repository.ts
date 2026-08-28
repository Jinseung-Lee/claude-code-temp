import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardEntry, LeaderboardSubmission } from "./leaderboard";
import type { Difficulty } from "./types";

/**
 * 싱글모드 기록을 프로세스 메모리가 아니라 Supabase에 저장한다. 서버가
 * 재시작되거나 요청이 다른 인스턴스로 가더라도 기록이 사라지지 않게 하는
 * 것이 목적이다. 구조는 `room-repository.ts`와 같은 방식을 따른다.
 */

export const LEADERBOARD_TABLE = "single_scores";

/**
 * 한 페이지에 담는 기록 수. 전체 순위를 나눠 읽는 단위다.
 */
export const SCORE_PAGE_SIZE = 50;

/**
 * 순위를 매기려면 전체 기록을 한 번은 읽어야 하므로, 한 번에 읽어들이는
 * 양에 상한을 둔다. 이 수를 넘으면 오래된 기록은 순위 계산에서 빠지고,
 * 호출하는 쪽이 `truncated`로 그 사실을 알 수 있다.
 */
const RANKING_SOURCE_LIMIT = 5_000;

/** 기록 조회 결과. 상한에 걸려 잘렸는지를 함께 알려준다. */
export interface ScoreListResult {
  entries: LeaderboardEntry[];
  /** 저장된 기록이 `RANKING_SOURCE_LIMIT`을 넘어 일부가 빠졌는지. */
  truncated: boolean;
}

export interface LeaderboardBackend {
  insert(submission: LeaderboardSubmission): Promise<LeaderboardEntry>;
  /** 순위 계산에 쓸 기록을 돌려준다. 정렬은 호출하는 쪽에서 한다. */
  listAll(): Promise<ScoreListResult>;
}

interface ScoreRow {
  id: string;
  nickname: string;
  category: string;
  difficulty: Difficulty;
  cleared_all: boolean;
  elapsed_ms: number | null;
  cleared_count: number;
  created_at: string;
}

const SCORE_COLUMNS =
  "id, nickname, category, difficulty, cleared_all, elapsed_ms, cleared_count, created_at";

function rowToEntry(row: ScoreRow): LeaderboardEntry {
  return {
    id: row.id,
    nickname: row.nickname,
    category: row.category,
    difficulty: row.difficulty,
    clearedAll: row.cleared_all,
    elapsedMs: row.elapsed_ms,
    clearedCount: row.cleared_count,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * `room-repository.ts`의 클라이언트와 같은 이유로 모듈 전역에 캐싱해도
 * 안전하다. secret key만 쓰고 세션을 저장하지 않으므로 요청 사이에 섞일
 * 상태가 없다.
 */
let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "기록 저장에는 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY 환경변수가 필요합니다.",
    );
  }

  cachedClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

const supabaseBackend: LeaderboardBackend = {
  async insert(submission) {
    const { data, error } = await getClient()
      .from(LEADERBOARD_TABLE)
      .insert({
        nickname: submission.nickname,
        category: submission.category,
        difficulty: submission.difficulty,
        cleared_all: submission.clearedAll,
        elapsed_ms: submission.elapsedMs,
        cleared_count: submission.clearedCount,
      })
      .select(SCORE_COLUMNS)
      .single<ScoreRow>();

    if (error) throw new Error(`기록 저장에 실패했습니다: ${error.message}`);
    return rowToEntry(data);
  },

  async listAll() {
    // 상한보다 1개 더 읽어, 잘렸는지를 별도 count 질의 없이 판정한다.
    const { data, error } = await getClient()
      .from(LEADERBOARD_TABLE)
      .select(SCORE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(RANKING_SOURCE_LIMIT + 1);

    if (error) throw new Error(`기록 조회에 실패했습니다: ${error.message}`);
    const rows = (data ?? []).map((row) => rowToEntry(row as ScoreRow));
    return {
      entries: rows.slice(0, RANKING_SOURCE_LIMIT),
      truncated: rows.length > RANKING_SOURCE_LIMIT,
    };
  },
};

/** DB 없이 기록 로직을 검증할 때 쓰는 인메모리 백엔드. */
export function createInMemoryLeaderboardBackend(): LeaderboardBackend {
  const rows: LeaderboardEntry[] = [];

  return {
    async insert(submission) {
      const entry: LeaderboardEntry = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        ...submission,
      };
      rows.push(entry);
      return { ...entry };
    },
    async listAll() {
      // Supabase 구현과 같이 최근 기록을 남긴다.
      return {
        entries: rows.slice(-RANKING_SOURCE_LIMIT).map((row) => ({ ...row })),
        truncated: rows.length > RANKING_SOURCE_LIMIT,
      };
    },
  };
}

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/**
 * Supabase 설정이 없을 때 쓰는 인메모리 백엔드는 globalThis에 캐싱한다.
 * 개발 중 HMR로 모듈이 재평가되어도 같은 저장소를 계속 쓰게 한다.
 */
const FALLBACK_KEY = "__chosungFallbackLeaderboardBackend";

function getFallbackBackend(): LeaderboardBackend {
  const globalScope = globalThis as typeof globalThis & {
    [FALLBACK_KEY]?: LeaderboardBackend;
  };
  globalScope[FALLBACK_KEY] ??= createInMemoryLeaderboardBackend();
  return globalScope[FALLBACK_KEY];
}

let warnedAboutFallback = false;
let injectedBackend: LeaderboardBackend | null = null;

/** 테스트에서 백엔드를 직접 끼우기 위한 훅. null이면 자동 선택으로 되돌린다. */
export function setLeaderboardBackend(next: LeaderboardBackend | null): void {
  injectedBackend = next;
}

/**
 * 실제로 쓸 백엔드를 고른다. Supabase 설정이 있으면 그쪽에 저장해 서버
 * 재시작에도 기록이 살아남는다. 설정이 없으면 예외를 던지는 대신 인메모리로
 * 떨어뜨려, 환경변수를 채우지 않은 환경에서도 게임이 그대로 동작하게 한다.
 */
function resolveBackend(): LeaderboardBackend {
  if (injectedBackend) return injectedBackend;
  if (isSupabaseConfigured()) return supabaseBackend;

  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[leaderboard] Supabase 설정이 없어 싱글모드 기록을 메모리에 보관합니다. " +
        "서버가 재시작되면 기록이 사라집니다. " +
        "NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY를 설정하면 영속 저장으로 전환됩니다.",
    );
  }
  return getFallbackBackend();
}

export async function insertScore(submission: LeaderboardSubmission): Promise<LeaderboardEntry> {
  return resolveBackend().insert(submission);
}

export async function listAllScores(): Promise<ScoreListResult> {
  return resolveBackend().listAll();
}
