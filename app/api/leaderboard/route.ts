import { NextRequest, NextResponse } from "next/server";
import { getTopEntries, submitLeaderboardResult } from "@/lib/game/leaderboard";
import { CATEGORIES } from "@/lib/game/questions";
import type { Difficulty } from "@/lib/game/types";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export async function GET() {
  return NextResponse.json({ entries: getTopEntries(10) });
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
  if (typeof clearedCount !== "number" || clearedCount < 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const entry = submitLeaderboardResult({
    nickname: trimmedNickname,
    category: category!,
    difficulty: difficulty as Difficulty,
    clearedAll: Boolean(clearedAll),
    elapsedMs: typeof elapsedMs === "number" ? elapsedMs : null,
    clearedCount,
  });

  return NextResponse.json({ entry, entries: getTopEntries(10) });
}
