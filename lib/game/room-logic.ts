import { getChosung, isCorrectAnswer, maskWordWithIndexes, reverseSyllables } from "./chosung";
import { ITEM_DEFINITIONS, drawRandomItemType } from "./items";
import { pickRandomQuestion } from "./questions";
import { computeRanking } from "./ranking";
import {
  CHAT_HISTORY_LIMIT,
  DELAY_ITEM_MS,
  LOBBY_IDLE_TIMEOUT_MS,
  MAX_PLAYERS,
  ROUND_DURATION_MS,
  ROUND_RESULT_MS,
  TOTAL_ROUNDS,
  type ActiveEffect,
  type ChatMessage,
  type ClientRoomView,
  type Difficulty,
  type ItemQuestionState,
  type ItemType,
  type Player,
  type Room,
  type RoomSummary,
  type RoomSummaryPlayer,
  type RoundState,
} from "./types";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 혼동되는 0/O/1/I 제외

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function makeId(): string {
  return crypto.randomUUID();
}

function makePlayer(nickname: string, isHost: boolean): Player {
  return {
    id: makeId(),
    nickname,
    isHost,
    joinedAt: Date.now(),
    roundWins: 0,
    correctRounds: 0,
    totalAnswerMs: 0,
    items: [],
    activeEffects: [],
    shieldActive: false,
  };
}

function generateItemQuestion(
  category: string,
  difficulty: Difficulty,
  exclude: string[],
): ItemQuestionState {
  const question = pickRandomQuestion(category, Math.random, exclude, difficulty);
  const { masked, maskedIndexes } = maskWordWithIndexes(question.answer, difficulty);
  return { answer: question.answer, maskedQuestion: masked, maskedIndexes };
}

function startNewRound(room: Room, index: number, previousAnswers: string[]): RoundState {
  const category = room.category ?? "사자성어";
  const difficulty: Difficulty = room.difficulty ?? "medium";
  const question = pickRandomQuestion(category, Math.random, previousAnswers, difficulty);
  const { masked, maskedIndexes } = maskWordWithIndexes(question.answer, difficulty);
  const now = Date.now();

  room.players.forEach((player) => {
    player.activeEffects = [];
    player.shieldActive = false;
  });

  const itemQuestions: Record<string, ItemQuestionState> = {};
  room.players.forEach((player) => {
    itemQuestions[player.id] = generateItemQuestion(category, difficulty, [question.answer]);
  });

  return {
    index,
    category,
    difficulty,
    answer: question.answer,
    maskedQuestion: masked,
    maskedIndexes,
    startedAt: now,
    durationMs: ROUND_DURATION_MS,
    winnerId: null,
    winnerAnswerMs: null,
    endedAt: null,
    resultUntil: null,
    pendingAnswers: [],
    wrongPlayerIds: [],
    extraHiddenIndexes: {},
    itemQuestions,
  };
}

function currentRound(room: Room): RoundState | undefined {
  return room.rounds[room.currentRoundIndex];
}

/**
 * 방의 시간 기반 상태를 현재 시각 기준으로 갱신한다. 모든 조회·조작
 * 함수는 이 함수를 먼저 호출해 지연 판정, 시간 초과, 라운드 자동 진행을
 * 일관되게 반영한다.
 */
export function tick(room: Room): void {
  const now = Date.now();

  if (room.phase === "disbanded" || room.phase === "finished") return;

  // 대기실에서 정해진 시간 동안 아무 활동이 없으면 방을 해체한다.
  if (room.phase === "lobby" && now - room.lastActivityAt >= LOBBY_IDLE_TIMEOUT_MS) {
    room.phase = "disbanded";
    room.endReason = "idle_disbanded";
    return;
  }

  // 게임 중 이탈로 1명만 남으면 남은 라운드를 진행하지 않고 즉시 끝낸다.
  if (
    (room.phase === "round_active" || room.phase === "round_result") &&
    room.players.length <= 1
  ) {
    room.phase = "finished";
    room.endReason = "last_player_standing";
    return;
  }

  if (room.phase === "round_active") {
    const round = currentRound(room);
    if (!round) return;

    if (round.winnerId === null) {
      const eligible = round.pendingAnswers.filter((a) => a.effectiveAt <= now);
      if (eligible.length > 0) {
        const winner = eligible.reduce((min, a) => (a.effectiveAt < min.effectiveAt ? a : min));
        const player = room.players.find((p) => p.id === winner.playerId);
        if (player) {
          const answerMs = Math.max(0, winner.effectiveAt - round.startedAt);
          player.roundWins += 1;
          player.correctRounds += 1;
          player.totalAnswerMs += answerMs;
          player.items.push({ id: makeId(), type: drawRandomItemType() });
          round.winnerId = player.id;
          round.winnerAnswerMs = answerMs;
        }
        round.endedAt = now;
        round.resultUntil = now + ROUND_RESULT_MS;
        room.phase = "round_result";
      } else if (now >= round.startedAt + round.durationMs) {
        round.endedAt = now;
        round.resultUntil = now + ROUND_RESULT_MS;
        room.phase = "round_result";
      }
    }
  }

  if (room.phase === "round_result") {
    const round = currentRound(room);
    if (round?.resultUntil !== null && round?.resultUntil !== undefined && now >= round.resultUntil) {
      if (room.currentRoundIndex + 1 >= TOTAL_ROUNDS) {
        room.phase = "finished";
      } else {
        const previousAnswers = room.rounds.map((r) => r.answer);
        room.currentRoundIndex += 1;
        room.rounds.push(startNewRound(room, room.currentRoundIndex, previousAnswers));
        room.phase = "round_active";
      }
    }
  }
}

export function makeRoom(code: string, hostNickname: string): { room: Room; player: Player } {
  const host = makePlayer(hostNickname, true);
  const room: Room = {
    code,
    hostId: host.id,
    players: [host],
    phase: "lobby",
    category: null,
    difficulty: null,
    rounds: [],
    currentRoundIndex: -1,
    createdAt: Date.now(),
    chatMessages: [],
    lastActivityAt: Date.now(),
    endReason: null,
  };
  return { room, player: host };
}

/**
 * 닉네임 비교용 정규화. 앞뒤 공백과 대소문자 차이만으로 같은 이름이
 * 둘 생기면 화면에서 서로를 구분할 수 없다.
 */
export function normalizeNickname(nickname: string): string {
  return nickname.trim().toLowerCase();
}

export function isNicknameTaken(room: Room, nickname: string): boolean {
  const target = normalizeNickname(nickname);
  return room.players.some((p) => normalizeNickname(p.nickname) === target);
}

export function addPlayer(room: Room, nickname: string): { player: Player } | { error: string } {
  if (room.phase === "disbanded") return { error: "해체된 방입니다." };
  if (room.phase !== "lobby") return { error: "이미 게임이 시작된 방입니다." };
  if (room.players.length >= MAX_PLAYERS) return { error: "방 인원이 가득 찼습니다(최대 4인)." };
  if (isNicknameTaken(room, nickname)) {
    return { error: "이미 사용 중인 ID입니다. 다른 ID를 만들어 주세요." };
  }

  const player = makePlayer(nickname, false);
  room.players.push(player);
  room.lastActivityAt = Date.now();
  return { player };
}

/**
 * 참가자를 방에서 뺀다. 방장이 나가면 남은 사람 중 가장 먼저 들어온 사람이
 * 새 방장이 된다. 게임 중이었다면 남은 인원에 따라 tick이 종료를 판정한다.
 */
export function removePlayer(room: Room, playerId: string): { ok: true } | { error: string } {
  const index = room.players.findIndex((p) => p.id === playerId);
  if (index === -1) return { error: "이 방의 참가자가 아닙니다." };

  room.players.splice(index, 1);
  room.lastActivityAt = Date.now();

  if (room.players.length === 0) {
    // 아무도 남지 않은 방은 목록에서 감추고 다시 들어올 수 없게 한다.
    room.phase = "disbanded";
    room.endReason = "idle_disbanded";
    return { ok: true };
  }

  if (room.hostId === playerId) {
    const nextHost = room.players.reduce((earliest, p) =>
      p.joinedAt < earliest.joinedAt ? p : earliest,
    );
    room.hostId = nextHost.id;
    room.players.forEach((p) => {
      p.isHost = p.id === nextHost.id;
    });
  }

  // 게임 중 1인만 남은 경우의 종료 판정은 tick이 한 곳에서 처리한다.
  tick(room);
  return { ok: true };
}

export function beginGame(
  room: Room,
  actorId: string,
  category: string,
  difficulty: Difficulty,
): { ok: true } | { error: string } {
  if (room.hostId !== actorId) return { error: "방장만 게임을 시작할 수 있습니다." };
  if (room.phase !== "lobby") return { error: "이미 게임이 시작되었습니다." };
  if (room.players.length < 2) return { error: "2명 이상 모여야 시작할 수 있습니다." };

  room.category = category;
  room.difficulty = difficulty;
  room.currentRoundIndex = 0;
  room.rounds = [startNewRound(room, 0, [])];
  room.phase = "round_active";
  room.lastActivityAt = Date.now();
  return { ok: true };
}

export function applyAnswer(
  room: Room,
  playerId: string,
  text: string,
): { correct: boolean } | { error: string } {
  if (room.phase !== "round_active") return { error: "라운드가 진행 중이 아닙니다." };
  const round = currentRound(room);
  const player = room.players.find((p) => p.id === playerId);
  if (!round || !player) return { error: "잘못된 요청입니다." };
  if (round.winnerId !== null) return { correct: false };
  if (round.pendingAnswers.some((a) => a.playerId === playerId)) return { correct: true };

  const isReversed = player.activeEffects.some((e) => e.itemType === "reverse_input");
  const expected = isReversed ? reverseSyllables(round.answer) : round.answer;
  const correct = isCorrectAnswer(text, expected);

  if (!correct) {
    if (!round.wrongPlayerIds.includes(playerId)) round.wrongPlayerIds.push(playerId);
    return { correct: false };
  }

  const isDelayed = player.activeEffects.some((e) => e.itemType === "delay");
  const submittedAt = Date.now();
  round.pendingAnswers.push({
    playerId,
    submittedAt,
    effectiveAt: submittedAt + (isDelayed ? DELAY_ITEM_MS : 0),
  });
  tick(room);
  return { correct: true };
}

export function applyItemQuestionAnswer(
  room: Room,
  playerId: string,
  text: string,
): { correct: boolean } | { error: string } {
  if (room.phase !== "round_active") return { error: "라운드가 진행 중이 아닙니다." };
  const round = currentRound(room);
  const player = room.players.find((p) => p.id === playerId);
  if (!round || !player) return { error: "잘못된 요청입니다." };

  const question = round.itemQuestions[playerId];
  if (!question) return { error: "아이템 문제가 없습니다." };
  if (!isCorrectAnswer(text, question.answer)) return { correct: false };

  player.items.push({ id: makeId(), type: drawRandomItemType() });
  // 계속 도전할 수 있도록 곧바로 새 아이템 문제를 내준다.
  round.itemQuestions[playerId] = generateItemQuestion(round.category, round.difficulty, [
    round.answer,
    question.answer,
  ]);
  return { correct: true };
}

export function appendChatMessage(
  room: Room,
  playerId: string,
  text: string,
): { ok: true } | { error: string } {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { error: "잘못된 요청입니다." };
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return { error: "메시지를 입력해 주세요." };

  const message: ChatMessage = {
    id: makeId(),
    playerId,
    nickname: player.nickname,
    text: trimmed,
    createdAt: Date.now(),
  };
  room.chatMessages.push(message);
  room.lastActivityAt = Date.now();
  if (room.chatMessages.length > CHAT_HISTORY_LIMIT) {
    room.chatMessages = room.chatMessages.slice(-CHAT_HISTORY_LIMIT);
  }
  return { ok: true };
}

export function useItem(
  room: Room,
  playerId: string,
  itemInstanceId: string,
  targetId: string | undefined,
): { ok: true } | { error: string } {
  if (room.phase !== "round_active") return { error: "라운드가 진행 중이 아닙니다." };

  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { error: "잘못된 요청입니다." };
  const itemIndex = player.items.findIndex((i) => i.id === itemInstanceId);
  if (itemIndex === -1) return { error: "보유하지 않은 아이템입니다." };
  const item = player.items[itemIndex];
  const definition = ITEM_DEFINITIONS[item.type];

  player.items.splice(itemIndex, 1);

  if (definition.kind === "defense") {
    player.shieldActive = true;
    player.activeEffects = [];
    return { ok: true };
  }

  if (!targetId || targetId === playerId) return { error: "공격 대상을 선택해야 합니다." };
  const target = room.players.find((p) => p.id === targetId);
  if (!target) return { error: "대상을 찾을 수 없습니다." };

  if (target.shieldActive) return { ok: true }; // 방어막에 막혀 효과 없음(아이템은 이미 소모됨)

  if (item.type === "steal") {
    if (target.items.length > 0) {
      const stolenIndex = Math.floor(Math.random() * target.items.length);
      const [stolen] = target.items.splice(stolenIndex, 1);
      player.items.push({ id: makeId(), type: stolen.type });
    }
    return { ok: true }; // 훔치기는 지속 효과가 아니라 즉시 발동하는 아이템이다.
  }

  const effect: ActiveEffect = {
    id: makeId(),
    itemType: item.type as Exclude<ItemType, "shield" | "steal">,
    fromPlayerId: playerId,
    appliedAt: Date.now(),
  };
  target.activeEffects.push(effect);

  if (item.type === "hide_syllable") {
    const round = currentRound(room);
    if (round) {
      const alreadyHidden = new Set([
        ...round.maskedIndexes,
        ...(round.extraHiddenIndexes[target.id] ?? []),
      ]);
      const candidates = Array.from(round.answer)
        .map((_char, index) => index)
        .filter((index) => !alreadyHidden.has(index));
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        round.extraHiddenIndexes[target.id] = [...(round.extraHiddenIndexes[target.id] ?? []), pick];
      }
    }
  }

  return { ok: true };
}

export function serializeForPlayer(room: Room, requestingPlayerId: string): ClientRoomView {
  const round = currentRound(room);
  const showAnswer = room.phase === "round_result" || room.phase === "finished";

  let questionView = "";
  if (round) {
    const extraHidden = round.extraHiddenIndexes[requestingPlayerId] ?? [];
    const hiddenSet = new Set([...round.maskedIndexes, ...extraHidden]);
    questionView = Array.from(round.answer)
      .map((char, index) => (hiddenSet.has(index) ? getChosung(char) : char))
      .join("");
  }

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    category: room.category,
    difficulty: room.difficulty,
    totalRounds: TOTAL_ROUNDS,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isHost: p.isHost,
      roundWins: p.roundWins,
      correctRounds: p.correctRounds,
      averageAnswerMs: p.correctRounds > 0 ? p.totalAnswerMs / p.correctRounds : null,
      itemCount: p.items.length,
      activeEffectTypes: p.activeEffects.map((e) => e.itemType),
      isSelf: p.id === requestingPlayerId,
      ...(p.id === requestingPlayerId
        ? {
            items: p.items.map((i) => ({ id: i.id, ...ITEM_DEFINITIONS[i.type] })),
            shieldActive: p.shieldActive,
            myActiveEffects: p.activeEffects.map((e) => ({ id: e.id, type: e.itemType })),
          }
        : {}),
    })),
    round: round
      ? {
          index: round.index,
          category: round.category,
          difficulty: round.difficulty,
          durationMs: round.durationMs,
          startedAt: round.startedAt,
          question: questionView,
          answer: showAnswer ? round.answer : null,
          winnerId: round.winnerId,
          winnerAnswerMs: round.winnerAnswerMs,
          myItemQuestion: round.itemQuestions[requestingPlayerId]?.maskedQuestion ?? null,
        }
      : null,
    ranking: room.phase === "finished" ? computeRanking(room.players) : null,
    chatMessages: room.chatMessages.slice(-50),
    serverTime: Date.now(),
    endReason: room.endReason,
    idleTimeoutRemainingMs:
      room.phase === "lobby"
        ? Math.max(0, room.lastActivityAt + LOBBY_IDLE_TIMEOUT_MS - Date.now())
        : null,
  };
}

/**
 * 방 목록에 쓸 요약을 만든다. 진행 중인 정답은 절대 포함하지 않는다.
 *
 * 게임이 진행 중인 방은 참가자를 순위 순으로 담고, 대기 중인 방은 순위를
 * 매길 근거가 없으므로 입장 순서 그대로 담는다.
 */
export function summarizeRoom(room: Room): RoomSummary {
  const host = room.players.find((p) => p.id === room.hostId);
  const inProgress = room.phase === "round_active" || room.phase === "round_result";

  const players: RoomSummaryPlayer[] = inProgress
    ? computeRanking(room.players).map((ranked) => ({
        nickname: ranked.nickname,
        isHost: ranked.id === room.hostId,
        rank: ranked.rank,
        roundWins: ranked.roundWins,
      }))
    : room.players.map((p) => ({
        nickname: p.nickname,
        isHost: p.id === room.hostId,
        rank: null,
        roundWins: p.roundWins,
      }));

  return {
    code: room.code,
    hostNickname: host?.nickname ?? "알 수 없음",
    phase: room.phase,
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    category: room.category,
    difficulty: room.difficulty,
    joinable: room.phase === "lobby" && room.players.length < MAX_PLAYERS,
    createdAt: room.createdAt,
    players,
  };
}
