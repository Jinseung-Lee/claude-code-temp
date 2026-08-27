import { NextRequest, NextResponse } from "next/server";
import { startGame } from "@/lib/game/room-store";
import { CATEGORIES } from "@/lib/game/questions";
import type { Difficulty } from "@/lib/game/types";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const { actorId, category, difficulty } = body as {
    actorId?: string;
    category?: string;
    difficulty?: string;
  };

  if (!actorId || !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) {
    return NextResponse.json({ error: "잘못된 난이도입니다." }, { status: 400 });
  }

  const result = startGame(code, actorId, category!, difficulty as Difficulty);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
