import { NextRequest, NextResponse } from "next/server";
import { leaveRoom } from "@/lib/game/room-store";
import { withRoomConflictHandling } from "../../_lib/conflict";

/**
 * 탭을 닫을 때 `navigator.sendBeacon`이 부르는 이탈 경로. 화면의 나가기
 * 버튼은 `DELETE /api/rooms/[code]`를 쓰고, 이쪽은 같은 동작을 POST로
 * 받는다. sendBeacon은 메서드를 고를 수 없어 POST만 보낼 수 있기 때문이다.
 *
 * 페이지가 사라지는 순간의 신호는 재시도할 수 없다. 그래서 이미 지워진
 * 방이나 없는 참가자에 대한 요청도 오류로 보지 않는다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const playerId = typeof body.playerId === "string" ? body.playerId : "";

  if (!playerId) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  return withRoomConflictHandling(async () => {
    const result = await leaveRoom(code, playerId);
    if ("error" in result) return NextResponse.json({ ok: true, deleted: false });
    return NextResponse.json({ ok: true, deleted: result.deleted });
  });
}
