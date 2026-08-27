import { NextRequest, NextResponse } from "next/server";
import { applyItemUse } from "@/lib/game/room-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const { playerId, itemId, targetId } = body as {
    playerId?: string;
    itemId?: string;
    targetId?: string;
  };
  if (!playerId || !itemId) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const result = applyItemUse(code, playerId, itemId, targetId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
