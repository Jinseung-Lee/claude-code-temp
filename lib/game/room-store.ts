import {
  addPlayer,
  appendChatMessage,
  applyAnswer,
  applyItemQuestionAnswer,
  beginGame,
  generateRoomCode,
  makeRoom,
  serializeForPlayer,
  tick,
  useItem,
} from "./room-logic";
import { insertRoom, mutateRoom } from "./room-repository";
import type { Difficulty, Player, Room } from "./types";

export { serializeForPlayer } from "./room-logic";

/**
 * 방 상태 접근 계층. 순수 게임 로직(`room-logic.ts`)과 영속화
 * (`room-repository.ts`)를 잇는다. 모든 조작은 "읽기 → 로직 적용 →
 * 낙관적 락 저장"을 한 번에 처리하므로, 동시 요청은 저장 단계에서
 * 걸러지고 재시도된다.
 */

const CODE_GENERATION_ATTEMPTS = 10;

export async function createRoom(hostNickname: string): Promise<{ room: Room; player: Player }> {
  // 코드 중복은 사전 조회가 아니라 insert 실패로 판정한다. 사전 조회와
  // insert 사이에 다른 인스턴스가 같은 코드를 넣는 경합을 피할 수 있다.
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const { room, player } = makeRoom(generateRoomCode(), hostNickname);
    if (await insertRoom(room)) return { room, player };
  }
  throw new Error("방 코드를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

/** tick이 방을 실제로 바꿨는지 판단할 최소 지표. 불필요한 쓰기를 줄인다. */
function snapshotTimeState(room: Room): string {
  const round = room.rounds[room.currentRoundIndex];
  return [
    room.phase,
    room.currentRoundIndex,
    round?.winnerId ?? "",
    round?.endedAt ?? "",
    round?.resultUntil ?? "",
  ].join("|");
}

/**
 * 방을 읽어 시간 기반 상태를 갱신한 뒤 돌려준다. 라운드 자동 진행이
 * 조회 시점에 일어나므로 갱신 결과도 함께 저장한다.
 */
export async function getRoom(code: string): Promise<Room | undefined> {
  const outcome = await mutateRoom(code, (room) => {
    const before = snapshotTimeState(room);
    tick(room);
    return { result: undefined, persist: snapshotTimeState(room) !== before };
  });
  return outcome?.room;
}

export async function joinRoom(
  code: string,
  nickname: string,
  existingPlayerId?: string,
): Promise<{ room: Room; player: Player } | { error: string }> {
  const outcome = await mutateRoom(code, (room) => {
    tick(room);

    // 탭을 닫았거나 새로고침으로 연결이 끊긴 참가자는 게임 중에도 같은
    // playerId로 다시 붙을 수 있어야 한다.
    if (existingPlayerId) {
      const existing = room.players.find((p) => p.id === existingPlayerId);
      if (existing) {
        return { result: { player: existing }, persist: false };
      }
    }

    const result = addPlayer(room, nickname);
    return { result, persist: !("error" in result) };
  });

  if (!outcome) return { error: "존재하지 않는 방입니다." };
  if ("error" in outcome.result) return { error: outcome.result.error };
  return { room: outcome.room, player: outcome.result.player };
}

export async function startGame(
  code: string,
  actorId: string,
  category: string,
  difficulty: Difficulty,
): Promise<Room | { error: string }> {
  const outcome = await mutateRoom(code, (room) => {
    tick(room);
    const result = beginGame(room, actorId, category, difficulty);
    return { result, persist: !("error" in result) };
  });

  if (!outcome) return { error: "존재하지 않는 방입니다." };
  if ("error" in outcome.result) return { error: outcome.result.error };
  return outcome.room;
}

export async function submitAnswer(
  code: string,
  playerId: string,
  text: string,
): Promise<{ correct: boolean } | { error: string }> {
  const outcome = await mutateRoom(code, (room) => {
    tick(room);
    const result = applyAnswer(room, playerId, text);
    return { result, persist: !("error" in result) };
  });

  if (!outcome) return { error: "존재하지 않는 방입니다." };
  return outcome.result;
}

export async function submitItemQuestionAnswer(
  code: string,
  playerId: string,
  text: string,
): Promise<{ correct: boolean } | { error: string }> {
  const outcome = await mutateRoom(code, (room) => {
    tick(room);
    const result = applyItemQuestionAnswer(room, playerId, text);
    return { result, persist: !("error" in result) };
  });

  if (!outcome) return { error: "존재하지 않는 방입니다." };
  return outcome.result;
}

export async function sendChatMessage(
  code: string,
  playerId: string,
  text: string,
): Promise<Room | { error: string }> {
  const outcome = await mutateRoom(code, (room) => {
    const result = appendChatMessage(room, playerId, text);
    return { result, persist: !("error" in result) };
  });

  if (!outcome) return { error: "존재하지 않는 방입니다." };
  if ("error" in outcome.result) return { error: outcome.result.error };
  return outcome.room;
}

export async function applyItemUse(
  code: string,
  playerId: string,
  itemInstanceId: string,
  targetId: string | undefined,
): Promise<Room | { error: string }> {
  const outcome = await mutateRoom(code, (room) => {
    tick(room);
    const result = useItem(room, playerId, itemInstanceId, targetId);
    return { result, persist: !("error" in result) };
  });

  if (!outcome) return { error: "존재하지 않는 방입니다." };
  if ("error" in outcome.result) return { error: outcome.result.error };
  return outcome.room;
}

/** 방을 읽고 요청자 시점 뷰까지 한 번에 만든다. 폴링 응답에 쓴다. */
export async function getRoomView(
  code: string,
  playerId: string,
): Promise<
  | { view: ReturnType<typeof serializeForPlayer> }
  | { error: string; status: 403 | 404 }
> {
  const room = await getRoom(code);
  if (!room) return { error: "존재하지 않는 방입니다.", status: 404 };
  if (!room.players.some((p) => p.id === playerId)) {
    return { error: "이 방의 참가자가 아닙니다.", status: 403 };
  }
  return { view: serializeForPlayer(room, playerId) };
}
