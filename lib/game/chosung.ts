export type Difficulty = "easy" | "medium" | "hard";

const CHOSUNG_LIST = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const CHOSUNG_UNIT = 588; // 21 jungsung * 28 jongsung

const DIFFICULTY_RATIO: Record<Difficulty, number> = {
  easy: 0.25,
  medium: 0.5,
  hard: 1,
};

export function isHangulSyllable(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= HANGUL_BASE && code <= HANGUL_LAST;
}

export function getChosung(char: string): string {
  if (!isHangulSyllable(char)) return char;
  const index = Math.floor((char.charCodeAt(0) - HANGUL_BASE) / CHOSUNG_UNIT);
  return CHOSUNG_LIST[index];
}

export function toChosungString(word: string): string {
  return Array.from(word).map(getChosung).join("");
}

export function maskCountFor(length: number, difficulty: Difficulty): number {
  if (length <= 0) return 0;
  // 상 난이도는 전부 가리면 너무 가혹하므로, 음절 하나는 항상 힌트로 남겨 둔다.
  if (difficulty === "hard") return Math.max(0, length - 1);
  return Math.min(length, Math.max(1, Math.round(length * DIFFICULTY_RATIO[difficulty])));
}

function pickMaskIndexes(
  word: string,
  difficulty: Difficulty,
  rng: () => number,
): number[] {
  const chars = Array.from(word);
  const maskableIndexes = chars
    .map((char, index) => (isHangulSyllable(char) ? index : -1))
    .filter((index) => index !== -1);

  const count = maskCountFor(maskableIndexes.length, difficulty);
  const pool = [...maskableIndexes];
  const selected: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const pick = Math.floor(rng() * pool.length);
    selected.push(pool[pick]);
    pool.splice(pick, 1);
  }
  return selected;
}

export function applyMask(word: string, maskedIndexes: number[]): string {
  const set = new Set(maskedIndexes);
  return Array.from(word)
    .map((char, index) => (set.has(index) ? getChosung(char) : char))
    .join("");
}

/**
 * 단어를 난이도에 맞게 일부 음절만 초성으로 가린다.
 * rng는 테스트를 위해 주입 가능하며, 기본값은 Math.random이다.
 */
export function maskWord(
  word: string,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): string {
  return applyMask(word, pickMaskIndexes(word, difficulty, rng));
}

/** maskWord와 동일하지만, 어떤 음절을 가렸는지 인덱스도 함께 돌려준다. */
export function maskWordWithIndexes(
  word: string,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): { masked: string; maskedIndexes: number[] } {
  const maskedIndexes = pickMaskIndexes(word, difficulty, rng);
  return { masked: applyMask(word, maskedIndexes), maskedIndexes };
}

export function reverseSyllables(word: string): string {
  return Array.from(word).reverse().join("");
}

export function isCorrectAnswer(submitted: string, answer: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, "").trim();
  return normalize(submitted) === normalize(answer);
}
