import { NextRequest, NextResponse } from "next/server";
import { getRoomView, leaveRoom } from "@/lib/game/room-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const playerId = request.nextUrl.searchParams.get("playerId") ?? "";

  const result = await getRoomView(code, playerId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.view);
}

/** 참가자가 방을 나갈 때 호출한다. 홈으로 이동하는 버튼이 쓴다. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const result = await leaveRoom(code, playerId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
