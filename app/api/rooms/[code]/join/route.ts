import { NextRequest, NextResponse } from "next/server";
import { joinRoom } from "@/lib/game/room-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 12) : "";
  if (!nickname) {
    return NextResponse.json({ error: "닉네임을 입력해 주세요." }, { status: 400 });
  }

  const result = joinRoom(code, nickname);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ playerId: result.player.id });
}
