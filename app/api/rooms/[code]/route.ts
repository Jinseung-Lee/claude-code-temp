import { NextRequest, NextResponse } from "next/server";
import { getRoom, serializeForPlayer } from "@/lib/game/room-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const playerId = request.nextUrl.searchParams.get("playerId") ?? "";

  const room = getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "존재하지 않는 방입니다." }, { status: 404 });
  }
  if (!room.players.some((p) => p.id === playerId)) {
    return NextResponse.json({ error: "이 방의 참가자가 아닙니다." }, { status: 403 });
  }

  return NextResponse.json(serializeForPlayer(room, playerId));
}
