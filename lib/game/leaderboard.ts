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

/**
 * 카테고리를 전부 클리어한 기록(clearedAll)을 항상 앞에 두고, 그 안에서는
 * 클리어 시간이 빠른 순으로 정렬한다. 다 못 채운 기록끼리는 클리어한
 * 문제 개수가 많은 순으로 정렬한다.
 */
export function compareLeaderboardEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.clearedAll !== b.clearedAll) return a.clearedAll ? -1 : 1;
  if (a.clearedAll) return (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity);
  return b.clearedCount - a.clearedCount;
}

const entries: LeaderboardEntry[] = [];

export function submitLeaderboardResult(input: LeaderboardSubmission): LeaderboardEntry {
  const entry: LeaderboardEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...input,
  };
  entries.push(entry);
  return entry;
}

export function getTopEntries(limit = 10): LeaderboardEntry[] {
  return [...entries].sort(compareLeaderboardEntries).slice(0, limit);
}
