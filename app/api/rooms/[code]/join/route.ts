import { NextRequest, NextResponse } from "next/server";
import { joinRoom } from "@/lib/game/room-store";
import { withRoomConflictHandling } from "../../_lib/conflict";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 12) : "";
  const existingPlayerId =
    typeof body.existingPlayerId === "string" && body.existingPlayerId ? body.existingPlayerId : undefined;

  // 재입장은 기존 playerId만으로 성립하므로 닉네임을 요구하지 않는다.
  if (!nickname && !existingPlayerId) {
    return NextResponse.json({ error: "닉네임을 입력해 주세요." }, { status: 400 });
  }

  return withRoomConflictHandling(async () => {
    const result = await joinRoom(code, nickname, existingPlayerId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ playerId: result.player.id });
  });
}
