const KEY_PREFIX = "chosung-player:";

export function getStoredPlayerId(code: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(KEY_PREFIX + code.toUpperCase());
}

export function storePlayerId(code: string, playerId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY_PREFIX + code.toUpperCase(), playerId);
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
