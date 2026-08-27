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

export type RoomPhase = "lobby" | "round_active" | "round_result" | "finished";

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

export const MAX_PLAYERS = 4;
export const TOTAL_ROUNDS = 10;
export const ROUND_DURATION_MS = 15_000;
export const ROUND_RESULT_MS = 3_000;
export const DELAY_ITEM_MS = 3_000;
export const SINGLE_MODE_DURATION_MS = 60_000;

export const CHAT_HISTORY_LIMIT = 100;

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
}

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
}
