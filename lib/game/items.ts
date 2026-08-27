import type { ItemDefinition, ItemType } from "./types";

export const ITEM_DEFINITIONS: Record<ItemType, ItemDefinition> = {
  delay: {
    type: "delay",
    kind: "attack",
    name: "3초 지연",
    description: "지목한 상대가 제출한 정답이 3초 늦게 반영됩니다.",
  },
  hide_syllable: {
    type: "hide_syllable",
    kind: "attack",
    name: "초성 가리기",
    description: "지목한 상대에게 보이는 문제에서 음절 하나를 추가로 가립니다.",
  },
  reverse_input: {
    type: "reverse_input",
    kind: "attack",
    name: "거꾸로 입력",
    description: "지목한 상대는 정답을 거꾸로 입력해야 정답으로 인정됩니다.",
  },
  steal: {
    type: "steal",
    kind: "attack",
    name: "아이템 훔치기",
    description: "지목한 상대가 가진 아이템 하나를 무작위로 빼앗아 옵니다.",
  },
  clear_input: {
    type: "clear_input",
    kind: "attack",
    name: "입력 지우기",
    description: "지목한 상대가 지금 입력 중인 정답을 즉시 지웁니다.",
  },
  shield: {
    type: "shield",
    kind: "defense",
    name: "방어막",
    description: "사용하는 즉시 이번 라운드에 걸린 방해 효과를 없애고, 새로운 공격을 막습니다.",
  },
};

export const ATTACK_ITEM_TYPES: ItemType[] = [
  "delay",
  "hide_syllable",
  "reverse_input",
  "steal",
  "clear_input",
];
export const ALL_ITEM_TYPES: ItemType[] = [...ATTACK_ITEM_TYPES, "shield"];

/** 라운드 승자에게 지급할 아이템을 전체 아이템 풀에서 무작위로 뽑는다. */
export function drawRandomItemType(rng: () => number = Math.random): ItemType {
  const index = Math.floor(rng() * ALL_ITEM_TYPES.length);
  return ALL_ITEM_TYPES[Math.min(index, ALL_ITEM_TYPES.length - 1)];
}
