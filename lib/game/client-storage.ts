const KEY_PREFIX = "chosung-player:";

/**
 * 참가자 식별자는 localStorage에 둔다. sessionStorage에 두면 탭을 닫거나
 * 모바일 브라우저가 탭을 정리하는 순간 ID를 잃고, 진행 중인 방에는 다시
 * 들어갈 수 없게 된다.
 */
export function getStoredPlayerId(code: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY_PREFIX + code.toUpperCase());
}

export function storePlayerId(code: string, playerId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY_PREFIX + code.toUpperCase(), playerId);
}

const NICKNAME_KEY = "chosung-nickname";

/** 매번 새로 입력하지 않도록, 마지막으로 사용한 닉네임을 기억해 둔다. */
export function getRememberedNickname(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NICKNAME_KEY) ?? "";
}

export function rememberNickname(nickname: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NICKNAME_KEY, nickname);
}

/** 닉네임을 아직 만들지 않았는지. 홈에서 닉네임 입력 화면을 띄울 기준이다. */
export function hasNickname(): boolean {
  return getRememberedNickname().trim().length > 0;
}

/** 닉네임 최대 길이. 입력창과 서버 검증이 같은 값을 쓴다. */
export const NICKNAME_MAX_LENGTH = 12;
