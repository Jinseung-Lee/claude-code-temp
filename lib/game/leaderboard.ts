import { SCORE_PAGE_SIZE, insertScore, listAllScores } from "./leaderboard-repository";
import type { Difficulty } from "./types";

export interface LeaderboardEntry {
  id: string;
  nickname: string;
  category: string;
  difficulty: Difficulty;
  clearedAll: boolean;
  elapsedMs: number | null;
  clearedCount: number;
  createdAt: number;
}

export interface LeaderboardSubmission {
  nickname: string;
  category: string;
  difficulty: Difficulty;
  clearedAll: boolean;
  elapsedMs: number | null;
  clearedCount: number;
}

/** 순위가 매겨진 기록. 전체 순위 목록과 방금 내 기록의 순위 표시에 쓴다. */
export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
}

/** 기본 화면에 보여주는 상위 기록 개수. */
export const TOP_ENTRY_COUNT = 10;

/**
 * 카테고리를 전부 클리어한 기록(clearedAll)을 항상 앞에 두고, 그 안에서는
 * 클리어 시간이 빠른 순으로 정렬한다. 다 못 채운 기록끼리는 클리어한
 * 문제 개수가 많은 순으로 정렬한다.
 */
export function compareLeaderboardEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.clearedAll !== b.clearedAll) return a.clearedAll ? -1 : 1;
  if (a.clearedAll) return (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity);
  if (b.clearedCount !== a.clearedCount) return b.clearedCount - a.clearedCount;
  // 같은 성적이면 먼저 세운 기록을 앞에 둔다. 순서가 매번 흔들리지 않게 한다.
  return a.createdAt - b.createdAt;
}

/**
 * 기록을 순위 순으로 정렬하고 순위 번호를 붙인다. 성적이 완전히 같은
 * 기록은 같은 순위를 공유한다.
 */
export function rankEntries(entries: LeaderboardEntry[]): RankedLeaderboardEntry[] {
  const sorted = [...entries].sort(compareLeaderboardEntries);

  const ranked: RankedLeaderboardEntry[] = [];
  let previousRank = 0;
  sorted.forEach((entry, index) => {
    const previous = sorted[index - 1];
    const isTie =
      previous !== undefined &&
      previous.clearedAll === entry.clearedAll &&
      previous.elapsedMs === entry.elapsedMs &&
      previous.clearedCount === entry.clearedCount;
    const rank = isTie ? previousRank : index + 1;
    previousRank = rank;
    ranked.push({ ...entry, rank });
  });

  return ranked;
}

/**
 * 기록을 저장하고, 저장된 기록이 전체에서 몇 위인지 함께 돌려준다.
 * 순위 진입 여부와 무관하게 모든 기록을 남긴다.
 */
export async function submitLeaderboardResult(
  input: LeaderboardSubmission,
): Promise<{ entry: LeaderboardEntry; rank: number; totalCount: number }> {
  const entry = await insertScore(input);
  const { entries } = await listAllScores();
  const ranked = rankEntries(entries);
  const mine = ranked.find((e) => e.id === entry.id);

  return {
    entry,
    // 조회가 저장 직후라 항상 찾아야 하지만, 상한에 잘려 빠질 수 있으므로
    // 그 경우에는 맨 뒤 순위로 본다.
    rank: mine?.rank ?? ranked.length + 1,
    totalCount: ranked.length,
  };
}

/** 기본 화면용 상위 기록. */
export async function getTopEntries(limit = TOP_ENTRY_COUNT): Promise<RankedLeaderboardEntry[]> {
  const { entries } = await listAllScores();
  return rankEntries(entries).slice(0, limit);
}

/** 전체 순위 한 페이지. 잘림 여부와 다음 페이지 존재를 함께 알려준다. */
export interface RankedPage {
  entries: RankedLeaderboardEntry[];
  /** 순위를 매긴 전체 기록 수. */
  totalCount: number;
  /** 0부터 시작하는 페이지 번호. */
  page: number;
  pageSize: number;
  /** 다음 페이지가 있는지. */
  hasMore: boolean;
  /**
   * 저장된 기록이 순위 계산 상한을 넘어 오래된 기록이 빠졌는지.
   * 화면에서 "일부 오래된 기록은 제외됨"을 알리는 데 쓴다.
   */
  truncated: boolean;
}

/**
 * "전체 순위 보기" 옵션용. 저장된 기록에 순위를 붙여 한 페이지씩 돌려준다.
 * 순위는 전체를 기준으로 매기므로 페이지를 넘겨도 번호가 이어진다.
 */
export async function getRankedPage(page = 0, pageSize = SCORE_PAGE_SIZE): Promise<RankedPage> {
  const safePage = Math.max(0, Math.trunc(page));
  const safeSize = Math.min(Math.max(1, Math.trunc(pageSize)), SCORE_PAGE_SIZE);

  const { entries, truncated } = await listAllScores();
  const ranked = rankEntries(entries);
  const start = safePage * safeSize;

  return {
    entries: ranked.slice(start, start + safeSize),
    totalCount: ranked.length,
    page: safePage,
    pageSize: safeSize,
    hasMore: start + safeSize < ranked.length,
    truncated,
  };
}
