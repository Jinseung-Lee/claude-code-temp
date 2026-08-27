export interface Question {
  category: string;
  answer: string;
}

/**
 * 사전 제작된 문제 DB. 실제 서비스에서는 외부 DB로 교체·확장하는 것을
 * 전제로 하며, 이 프로젝트에서는 지속 업데이트 가능한 시드 데이터로 둔다.
 */
export const CATEGORIES = [
  "사자성어", "속담", "동물", "음식", "도시", "수도", "과일", "색깔", "직업", "스포츠",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const QUESTION_BANK: Record<Category, string[]> = {
  사자성어: [
    "유구무언", "일석이조", "고진감래", "동상이몽", "사면초가",
    "새옹지마", "임기응변", "청출어람", "적반하장", "우유부단",
  ],
  속담: [
    "가는말이고와야오는말이곱다", "발없는말이천리간다", "티끌모아태산",
    "우물안개구리", "빈수레가요란하다", "등잔밑이어둡다",
  ],
  동물: [
    "고슴도치", "너구리", "코알라", "물개", "펭귄", "다람쥐", "고양이", "호랑이",
  ],
  음식: [
    "떡볶이", "비빔밥", "삼겹살", "된장찌개", "김치찌개", "잡채", "순대", "만두",
  ],
  도시: [
    "서울", "부산", "인천", "대구", "대전", "광주", "울산", "수원",
  ],
  수도: [
    "도쿄", "베이징", "런던", "파리", "로마", "모스크바", "베를린", "마드리드",
  ],
  과일: [
    "사과", "바나나", "포도", "수박", "딸기", "오렌지", "키위", "망고",
  ],
  색깔: [
    "빨강", "파랑", "노랑", "초록", "보라", "주황", "분홍", "검정",
  ],
  직업: [
    "의사", "교사", "경찰", "소방관", "요리사", "변호사", "가수", "화가",
  ],
  스포츠: [
    "축구", "야구", "농구", "배구", "수영", "테니스", "골프", "탁구",
  ],
};

export function pickRandomQuestion(
  category: string,
  rng: () => number = Math.random,
  exclude: string[] = [],
): Question {
  const pool = (QUESTION_BANK[category as Category] ?? QUESTION_BANK.사자성어).filter(
    (word) => !exclude.includes(word),
  );
  const source = pool.length > 0 ? pool : QUESTION_BANK[category as Category] ?? QUESTION_BANK.사자성어;
  const index = Math.min(Math.floor(rng() * source.length), source.length - 1);
  return { category, answer: source[index] };
}
