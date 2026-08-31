import { NextRequest, NextResponse } from "next/server";
import {
  TOP_ENTRY_COUNT,
  getRankedPage,
  getTopEntries,
  submitLeaderboardResult,
} from "@/lib/game/leaderboard";
import { CATEGORIES, wordsFor } from "@/lib/game/questions";
import { SINGLE_MODE_DURATION_MS, type Difficulty } from "@/lib/game/types";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

// 기록은 매 요청마다 DB에서 새로 읽어야 한다. 프리렌더되면 빌드 시점의
// 빈 목록이 그대로 굳어버린다.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // ?scope=all이면 전체 순위를 페이지 단위로, 없으면 기본 화면용 TOP 10을
  // 돌려준다. 전체 순위는 ?page=N으로 다음 페이지를 읽는다.
  const params = request.nextUrl.searchParams;
  if (params.get("scope") === "all") {
    const page = Number.parseInt(params.get("page") ?? "0", 10);
    return NextResponse.json(await getRankedPage(Number.isNaN(page) ? 0 : page));
  }

  const entries = await getTopEntries(TOP_ENTRY_COUNT);
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { nickname, category, difficulty, clearedAll, elapsedMs, clearedCount } = body as {
    nickname?: string;
    category?: string;
    difficulty?: string;
    clearedAll?: boolean;
    elapsedMs?: number | null;
    clearedCount?: number;
  };

  const trimmedNickname = typeof nickname === "string" ? nickname.trim().slice(0, 12) : "";
  if (!trimmedNickname) {
    return NextResponse.json({ error: "닉네임을 입력해 주세요." }, { status: 400 });
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "잘못된 카테고리입니다." }, { status: 400 });
  }
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) {
    return NextResponse.json({ error: "잘못된 난이도입니다." }, { status: 400 });
  }
  const totalQuestions = wordsFor(category as string, difficulty as Difficulty).length;
  if (
    typeof clearedCount !== "number" ||
    !Number.isInteger(clearedCount) ||
    clearedCount < 0 ||
    // 카테고리에 있는 문제 수보다 많이 클리어할 수는 없다.
    clearedCount > totalQuestions
  ) {
    return NextResponse.json({ error: "잘못된 클리어 개수입니다." }, { status: 400 });
  }

  // 전체 클리어 기록은 클리어 시간으로 순위를 매기므로, 값이 조작되면
  // 랭킹 상위를 그대로 차지한다. 제한시간과 문제 수로 상·하한을 검증한다.
  const isFullClear = Boolean(clearedAll);
  if (isFullClear) {
    if (clearedCount !== totalQuestions) {
      return NextResponse.json(
        { error: "전체 클리어 기록은 클리어 개수가 문제 수와 같아야 합니다." },
        { status: 400 },
      );
    }
    if (
      typeof elapsedMs !== "number" ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs <= 0 ||
      elapsedMs > SINGLE_MODE_DURATION_MS
    ) {
      return NextResponse.json({ error: "잘못된 클리어 시간입니다." }, { status: 400 });
    }
  }

  const { entry, rank, totalCount } = await submitLeaderboardResult({
    nickname: trimmedNickname,
    category: category!,
    difficulty: difficulty as Difficulty,
    clearedAll: isFullClear,
    // 전체 클리어가 아닌 기록의 소요 시간은 순위에 쓰이지 않으므로 저장하지 않는다.
    elapsedMs: isFullClear ? (elapsedMs as number) : null,
    clearedCount,
  });

  return NextResponse.json({
    entry,
    rank,
    totalCount,
    entries: await getTopEntries(TOP_ENTRY_COUNT),
  });
}
