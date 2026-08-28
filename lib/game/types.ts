import type { Difficulty } from "./chosung";

export type { Difficulty };

export type ItemType = "delay" | "hide_syllable" | "reverse_input" | "steal" | "clear_input" | "shield";
export type ItemKind = "attack" | "defense";

export interface ItemDefinition {
  type: ItemType;
  kind: ItemKind;
  name: string;
  description: string;
}

export interface PlayerItem {
  id: string;
  type: ItemType;
}

export interface ActiveEffect {
  id: string;
  itemType: Exclude<ItemType, "shield" | "steal">;
  fromPlayerId: string;
  appliedAt: number;
}

export interface Player {
  id: string;
  nickname: string;
  isHost: boolean;
  joinedAt: number;
  roundWins: number;
  correctRounds: number;
  totalAnswerMs: number;
  items: PlayerItem[];
  activeEffects: ActiveEffect[];
  shieldActive: boolean;
}

export type RoomPhase = "lobby" | "round_active" | "round_result" | "finished" | "disbanded";

export interface PendingAnswer {
  playerId: string;
  submittedAt: number;
  effectiveAt: number;
}

export interface ItemQuestionState {
  answer: string;
  maskedQuestion: string;
  maskedIndexes: number[];
}

export interface RoundState {
  index: number;
  category: string;
  difficulty: Difficulty;
  answer: string;
  maskedQuestion: string;
  maskedIndexes: number[];
  startedAt: number;
  durationMs: number;
  winnerId: string | null;
  winnerAnswerMs: number | null;
  endedAt: number | null;
  resultUntil: number | null;
  pendingAnswers: PendingAnswer[];
  wrongPlayerIds: string[];
  extraHiddenIndexes: Record<string, number[]>;
  itemQuestions: Record<string, ItemQuestionState>;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  nickname: string;
  text: string;
  createdAt: number;
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "하",
  medium: "중",
  hard: "상",
};

export const MAX_PLAYERS = 4;
export const TOTAL_ROUNDS = 10;
export const ROUND_DURATION_MS = 15_000;
export const ROUND_RESULT_MS = 3_000;
export const DELAY_ITEM_MS = 3_000;
export const SINGLE_MODE_DURATION_MS = 60_000;

export const CHAT_HISTORY_LIMIT = 100;

/**
 * 대기실에서 이 시간 동안 아무 말도 없으면 방을 해체하고 참가자를 홈으로
 * 보낸다. 방을 만들어 두고 방치한 방이 목록에 남는 것을 막는다.
 */
export const LOBBY_IDLE_TIMEOUT_MS = 20_000;

export interface Room {
  code: string;
  hostId: string;
  players: Player[];
  phase: RoomPhase;
  category: string | null;
  difficulty: Difficulty | null;
  rounds: RoundState[];
  currentRoundIndex: number;
  createdAt: number;
  chatMessages: ChatMessage[];
  /** 대기실 무응답 해체 판정 기준. 채팅·입퇴장·설정 변경이 있을 때 갱신한다. */
  lastActivityAt: number;
  /** 게임이 정상 10라운드가 아닌 이유로 끝났을 때의 사유. */
  endReason: RoomEndReason | null;
}

/**
 * 방이 10라운드를 다 돌지 않고 끝난 이유.
 * - `last_player_standing`: 이탈로 1명만 남아 그 1명의 승리로 끝났다.
 * - `idle_disbanded`: 대기실에서 무응답 시간이 지나 방이 해체되었다.
 */
export type RoomEndReason = "last_player_standing" | "idle_disbanded";

export interface RankedPlayer {
  id: string;
  nickname: string;
  roundWins: number;
  averageAnswerMs: number | null;
  rank: number;
}

export interface ClientRoundView {
  index: number;
  category: string;
  difficulty: Difficulty;
  durationMs: number;
  startedAt: number;
  question: string;
  answer: string | null;
  winnerId: string | null;
  winnerAnswerMs: number | null;
  myItemQuestion: string | null;
}

export interface ClientItemView {
  id: string;
  type: ItemType;
  name: string;
  description: string;
  kind: ItemKind;
}

export interface ClientEffectView {
  id: string;
  type: ItemType;
}

export interface ClientPlayerView {
  id: string;
  nickname: string;
  isHost: boolean;
  roundWins: number;
  correctRounds: number;
  averageAnswerMs: number | null;
  itemCount: number;
  activeEffectTypes: string[];
  isSelf: boolean;
  items?: ClientItemView[];
  shieldActive?: boolean;
  myActiveEffects?: ClientEffectView[];
}

/** 방 목록 한 줄. 정답 같은 진행 정보는 담지 않는다. */
export interface RoomSummary {
  code: string;
  hostNickname: string;
  phase: RoomPhase;
  playerCount: number;
  maxPlayers: number;
  category: string | null;
  difficulty: Difficulty | null;
  /** 새 참가자를 받을 수 있는지. 로비이고 자리가 남은 경우에만 true. */
  joinable: boolean;
  createdAt: number;
  /** 참가 중인 사람들. 게임 중인 방은 순위 순, 대기 중인 방은 입장 순이다. */
  players: RoomSummaryPlayer[];
}

/** 방 목록에 보여줄 참가자 한 줄. */
export interface RoomSummaryPlayer {
  nickname: string;
  isHost: boolean;
  /** 게임이 진행 중인 방에서만 채운다. 대기 중인 방은 null. */
  rank: number | null;
  roundWins: number;
}

export interface ClientRoomView {
  code: string;
  phase: RoomPhase;
  hostId: string;
  category: string | null;
  difficulty: Difficulty | null;
  totalRounds: number;
  players: ClientPlayerView[];
  round: ClientRoundView | null;
  ranking: RankedPlayer[] | null;
  chatMessages: ChatMessage[];
  serverTime: number;
  endReason: RoomEndReason | null;
  /** 대기실 무응답 해체까지 남은 시간(밀리초). 대기실이 아니면 null. */
  idleTimeoutRemainingMs: number | null;
}
