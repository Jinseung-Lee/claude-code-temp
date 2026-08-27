import { NextRequest, NextResponse } from "next/server";
import { createRoom, listRooms } from "@/lib/game/room-store";

// 방 목록은 매 요청마다 DB에서 새로 읽어야 한다. 프리렌더되면 빌드 시점의
// 빈 목록이 그대로 굳어버린다.
export const dynamic = "force-dynamic";

export async function GET() {
  const rooms = await listRooms();
  return NextResponse.json({ rooms });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 12) : "";
  if (!nickname) {
    return NextResponse.json({ error: "닉네임을 입력해 주세요." }, { status: 400 });
  }

  const { room, player } = await createRoom(nickname);
  return NextResponse.json({ code: room.code, playerId: player.id });
}
