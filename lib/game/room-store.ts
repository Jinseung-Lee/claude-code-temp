import {
  addPlayer,
  appendChatMessage,
  applyAnswer,
  applyItemQuestionAnswer,
  beginGame,
  generateRoomCode,
  isRoomDeletable,
  makeRoom,
  removePlayer,
  serializeForPlayer,
  summarizeRoom,
  tick,
  useItem,
} from "./room-logic";
import { deleteRoom, insertRoom, listRecentRooms, mutateRoom } from "./room-repository";
import {
  LOBBY_IDLE_TIMEOUT_MS,
  type Difficulty,
  type Player,
  type Room,
  type RoomSummary,
} from "./types";

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
    room.endReason ?? "",
  ].join("|");
}

/**
 * 방을 읽어 시간 기반 상태를 갱신한 뒤 돌려준다. 라운드 자동 진행이
 * 조회 시점에 일어나므로 갱신 결과도 함께 저장한다.
 *
 * 방이 지워도 되는 상태면(`isRoomDeletable`) 이 조회에서 저장소에서
 * 지운다. 방은 게임 한 판 동안만 존재하므로 끝난 방을 남겨둘 이유가 없다.
 * 삭제해도 마지막 상태를 그대로 돌려주기 때문에 참가자들은 최종 순위와
 * 종료 사유를 볼 수 있다.
 */
export async function getRoom(code: string): Promise<Room | undefined> {
  const outcome = await mutateRoom(code, (room) => {
    const before = snapshotTimeState(room);
    tick(room);
    const changed = snapshotTimeState(room) !== before;
    return { result: { deletable: isRoomDeletable(room) }, persist: changed };
  });

  if (!outcome) return undefined;
  if (outcome.result.deletable) await deleteRoom(code);
  return outcome.room;
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

/**
 * 참가자를 방에서 뺀다. 홈으로 나가는 버튼과 방 이탈 API가 함께 쓴다.
 * 방장 이전, 1인 생존 종료, 빈 방 해체는 모두 room-logic이 판정한다.
 *
 * 이 이탈로 방이 종착 상태에 도달했으면 저장소에서 지운다. `deleted`로
 * 알려주므로 호출한 쪽은 방이 사라졌는지 알 수 있다.
 *
 * 없는 방에 대한 요청도 성공으로 처리한다. 나가기는 버튼과 페이지 종료
 * 신호로 두 번 도착할 수 있고, 방이 없다는 것은 이미 원하는 상태다.
 */
export async function leaveRoom(
  code: string,
  playerId: string,
): Promise<{ ok: true; deleted: boolean; room: Room | null } | { error: string }> {
  const outcome = await mutateRoom(code, (room) => {
    const result = removePlayer(room, playerId);
    return { result, persist: !("error" in result) };
  });

  if (!outcome) return { ok: true, deleted: true, room: null };
  if ("error" in outcome.result) return { error: outcome.result.error };

  // 방을 지우더라도 마지막 상태는 돌려준다. 남은 참가자에게 결과 화면을
  // 보여주려면 삭제 직전 상태가 필요하다.
  if (isRoomDeletable(outcome.room)) {
    await deleteRoom(code);
    return { ok: true, deleted: true, room: outcome.room };
  }
  return { ok: true, deleted: false, room: outcome.room };
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

/** 해체 사유를 그대로 알린다. 원인이 다른데 같은 문구를 쓰면 오해를 준다. */
function disbandedMessage(room: Room): string {
  if (room.endReason === "all_left") return "참가자가 모두 나가 방이 해체되었습니다.";
  return `${LOBBY_IDLE_TIMEOUT_MS / 1000}초 동안 활동이 없어 방이 해체되었습니다.`;
}

/** 방을 읽고 요청자 시점 뷰까지 한 번에 만든다. 폴링 응답에 쓴다. */
export async function getRoomView(
  code: string,
  playerId: string,
): Promise<
  | { view: ReturnType<typeof serializeForPlayer> }
  | { error: string; status: 403 | 404 | 410 }
> {
  const room = await getRoom(code);
  if (!room) return { error: "존재하지 않는 방입니다.", status: 404 };
  if (room.phase === "disbanded") {
    return { error: disbandedMessage(room), status: 410 };
  }
  if (!room.players.some((p) => p.id === playerId)) {
    return { error: "이 방의 참가자가 아닙니다.", status: 403 };
  }
  return { view: serializeForPlayer(room, playerId) };
}

/** 목록에 보여줄 방 개수 상한. 화면에 담기는 만큼만 읽는다. */
const ROOM_LIST_LIMIT = 30;

/** 이 시간이 지난 방은 목록에서 감춘다. 방치된 방으로 본다. */
const ROOM_LIST_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * 참가할 방을 고를 수 있도록 최근 방 목록을 돌려준다. 끝난 방과 오래
 * 방치된 방은 제외하고, 들어갈 수 있는 방을 앞에 둔다.
 *
 * tick을 돌리지 않으므로 phase는 마지막으로 저장된 값이다. 목록에서는
 * 대략적인 상태만 보여주면 되고, 실제 입장 가능 여부는 join 시점에
 * 서버가 다시 판정한다.
 */
export async function listRooms(): Promise<RoomSummary[]> {
  const rooms = await listRecentRooms(ROOM_LIST_LIMIT);
  const now = Date.now();

  return rooms
    .filter((room) => room.phase !== "finished" && room.phase !== "disbanded")
    // 무응답으로 해체될 시각이 이미 지난 방은 목록에서도 숨긴다. 실제 해체
    // 처리는 그 방을 조회하는 쪽의 tick이 저장한다.
    .filter(
      (room) =>
        room.phase !== "lobby" || now - room.lastActivityAt < LOBBY_IDLE_TIMEOUT_MS,
    )
    .filter((room) => now - room.createdAt < ROOM_LIST_MAX_AGE_MS)
    .map(summarizeRoom)
    .sort((a, b) => {
      if (a.joinable !== b.joinable) return a.joinable ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
}
