import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/lib/game/room-store";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 12) : "";
  if (!nickname) {
    return NextResponse.json({ error: "닉네임을 입력해 주세요." }, { status: 400 });
  }

  const { room, player } = createRoom(nickname);
  return NextResponse.json({ code: room.code, playerId: player.id });
}
