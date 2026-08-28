import { NextResponse } from "next/server";
import { RoomVersionConflictError } from "@/lib/game/room-repository";

/**
 * 방 상태 쓰기를 감싸, 낙관적 락 재시도가 모두 소진된 경우를 500이 아니라
 * 409로 돌려준다.
 *
 * 재시도 소진은 서버 결함이 아니라 "지금 너무 몰려서 이번 요청은 못 넣었다"는
 * 일시적 상태다. 500으로 내보내면 클라이언트가 복구할 수 없는 오류로 취급하고,
 * 사용자에게는 채팅이나 정답이 조용히 유실된 것처럼 보인다. 409로 알려주면
 * 호출한 쪽이 같은 요청을 다시 보낼 수 있다.
 */
export async function withRoomConflictHandling(
  run: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RoomVersionConflictError) {
      return NextResponse.json(
        { error: "잠시 요청이 몰렸습니다. 다시 시도해 주세요.", retryable: true },
        { status: 409 },
      );
    }
    throw error;
  }
}
