const ADJECTIVES = [
  "용감한", "귀여운", "재빠른", "든든한", "느긋한",
  "엉뚱한", "씩씩한", "졸린", "배고픈", "행복한",
];

const ANIMALS = [
  "여우", "펭귄", "고양이", "너구리", "다람쥐",
  "호랑이", "코알라", "수달", "부엉이", "고슴도치",
];

/** 닉네임을 직접 정하기 귀찮은 사용자를 위한 랜덤 닉네임 생성기. */
export function generateRandomNickname(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const number = Math.floor(Math.random() * 100);
  return `${adjective}${animal}${number}`;
}
