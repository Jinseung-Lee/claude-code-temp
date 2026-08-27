import type { Player, RankedPlayer } from "./types";

export interface Scoreable {
  roundWins: number;
  averageAnswerMs: number | null;
}

/**
 * 라운드 승리 횟수 내림차순으로 정렬하고, 동률이면 평균 정답 소요시간이
 * 빠른 쪽을 우선한다. 한 번도 맞히지 못한 참가자는 가장 뒤로 보낸다.
 * 서버의 최종 순위 계산과 클라이언트의 실시간 순위 사이드바가 이 함수를 공유한다.
 */
export function rankByScore<T extends Scoreable>(entries: T[]): (T & { rank: number })[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.roundWins !== a.roundWins) return b.roundWins - a.roundWins;
    if (a.averageAnswerMs === null && b.averageAnswerMs === null) return 0;
    if (a.averageAnswerMs === null) return 1;
    if (b.averageAnswerMs === null) return -1;
    return a.averageAnswerMs - b.averageAnswerMs;
  });

  const ranked: (T & { rank: number })[] = [];
  let previousRank = 0;
  sorted.forEach((entry, index) => {
    const previous = ranked[index - 1];
    const isTie =
      previous !== undefined &&
      previous.roundWins === entry.roundWins &&
      previous.averageAnswerMs === entry.averageAnswerMs;
    const rank = isTie ? previousRank : index + 1;
    previousRank = rank;
    ranked.push({ ...entry, rank });
  });

  return ranked;
}

function averageAnswerMs(player: Player): number | null {
  if (player.correctRounds === 0) return null;
  return player.totalAnswerMs / player.correctRounds;
}

export function computeRanking(players: Player[]): RankedPlayer[] {
  const withAverage = players.map((player) => ({
    id: player.id,
    nickname: player.nickname,
    roundWins: player.roundWins,
    averageAnswerMs: averageAnswerMs(player),
  }));

  return rankByScore(withAverage);
}
