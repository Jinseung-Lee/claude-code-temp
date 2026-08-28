import { NextRequest, NextResponse } from "next/server";
import { createRoom, listRooms } from "@/lib/game/room-store";
import {
  EPHEMERAL_STORAGE_ERROR,
  isEphemeralStorageUnsafe,
} from "@/lib/game/room-repository";

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

  // 저장소가 인스턴스별 메모리뿐이면 방을 만들어도 다음 요청에서 사라진다.
  // 게임 도중에 "존재하지 않는 방"으로 깨지는 대신 여기서 원인을 알린다.
  if (isEphemeralStorageUnsafe()) {
    return NextResponse.json({ error: EPHEMERAL_STORAGE_ERROR }, { status: 503 });
  }

  const { room, player } = await createRoom(nickname);
  return NextResponse.json({ code: room.code, playerId: player.id });
}
