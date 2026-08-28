import { NextRequest, NextResponse } from "next/server";
import { sendChatMessage } from "@/lib/game/room-store";
import { withRoomConflictHandling } from "../../_lib/conflict";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const { playerId, text } = body as { playerId?: string; text?: string };
  if (!playerId || typeof text !== "string") {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  return withRoomConflictHandling(async () => {
    const result = await sendChatMessage(code, playerId, text);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  });
}
