const KEY_PREFIX = "chosung-player:";

/**
 * 참가자 식별자는 탭 단위(sessionStorage)로 보관한다.
 *
 * localStorage에 두면 같은 브라우저 프로필의 두 창이 하나의 ID를
 * 공유해, 두 번째 창이 ID 생성 화면을 건너뛰고 첫 창과 같은 참가자로
 * 붙어버린다. sessionStorage는 탭마다 따로이면서 새로고침에는 살아남기
 * 때문에, 창을 여러 개 띄우는 이 게임에는 이쪽이 맞다.
 */
export function getStoredPlayerId(code: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(KEY_PREFIX + code.toUpperCase());
}

export function storePlayerId(code: string, playerId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY_PREFIX + code.toUpperCase(), playerId);
}

export function clearStoredPlayerId(code: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(KEY_PREFIX + code.toUpperCase());
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
