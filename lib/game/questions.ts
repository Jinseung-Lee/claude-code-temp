import type { Difficulty } from "./chosung";
import { CATEGORIES, WORD_BANK, type Category, type WordEntry } from "./word-bank";

export { CATEGORIES, WORD_BANK };
export type { Category, WordEntry };

export interface Question {
  category: string;
  answer: string;
}

/**
 * 카테고리별 정답 목록. 난이도를 구분하지 않는 전체 풀이며, 단어 수를
 * 세거나 전체를 순회하는 곳에서 쓴다.
 */
export const QUESTION_BANK: Record<Category, string[]> = Object.fromEntries(
  CATEGORIES.map((category) => [category, WORD_BANK[category].map((w) => w.answer)]),
) as Record<Category, string[]>;

function bankFor(category: string): WordEntry[] {
  return WORD_BANK[category as Category] ?? WORD_BANK.사자성어;
}

/**
 * 난이도에 해당하는 단어만 남긴 정답 목록.
 *
 * 난이도는 두 축으로 작동한다. 마스킹 비율은 chosung.ts가 담당하고,
 * 여기서는 단어 자체의 난이도(WordEntry.level)로 출제 범위를 좁힌다.
 * 상위 난이도는 하위 난이도 단어까지 포함해, 어려운 방에서도 쉬운 단어가
 * 섞여 나오도록 한다.
 */
export function wordsFor(category: string, difficulty?: Difficulty): string[] {
  const entries = bankFor(category);
  if (!difficulty) return entries.map((w) => w.answer);

  const allowed: Record<Difficulty, WordEntry["level"][]> = {
    easy: ["easy"],
    medium: ["easy", "medium"],
    hard: ["easy", "medium", "hard"],
  };
  const levels = allowed[difficulty];
  return entries.filter((w) => levels.includes(w.level)).map((w) => w.answer);
}

export function pickRandomQuestion(
  category: string,
  rng: () => number = Math.random,
  exclude: string[] = [],
  difficulty?: Difficulty,
): Question {
  const words = wordsFor(category, difficulty);
  const pool = words.filter((word) => !exclude.includes(word));
  // 이미 낸 문제를 다 소진했으면 중복을 허용하더라도 문제는 계속 내야 한다.
  const source = pool.length > 0 ? pool : words;
  const index = Math.min(Math.floor(rng() * source.length), source.length - 1);
  return { category, answer: source[index] };
}
