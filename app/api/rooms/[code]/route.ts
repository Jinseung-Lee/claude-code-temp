import { NextRequest, NextResponse } from "next/server";
import { getRoomView } from "@/lib/game/room-store";

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
