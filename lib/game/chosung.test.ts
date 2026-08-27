import { describe, expect, it } from "vitest";
import {
  getChosung,
  isCorrectAnswer,
  maskCountFor,
  maskWord,
  maskWordWithIndexes,
  reverseSyllables,
  toChosungString,
} from "./chosung";

describe("getChosung", () => {
  it("returns the leading consonant of a Hangul syllable", () => {
    expect(getChosung("유")).toBe("ㅇ");
    expect(getChosung("구")).toBe("ㄱ");
    expect(getChosung("무")).toBe("ㅁ");
    expect(getChosung("언")).toBe("ㅇ");
  });

  it("returns non-Hangul characters unchanged", () => {
    expect(getChosung(" ")).toBe(" ");
    expect(getChosung("A")).toBe("A");
  });
});

describe("toChosungString", () => {
  it("converts every syllable to its initial consonant", () => {
    expect(toChosungString("유구무언")).toBe("ㅇㄱㅁㅇ");
  });
});

describe("maskCountFor", () => {
  it("masks a quarter of syllables on easy, rounded and at least one", () => {
    expect(maskCountFor(4, "easy")).toBe(1);
  });

  it("masks half of syllables on medium", () => {
    expect(maskCountFor(4, "medium")).toBe(2);
  });

  it("masks all but one syllable on hard, leaving a single hint", () => {
    expect(maskCountFor(4, "hard")).toBe(3);
  });
});

describe("maskWord", () => {
  it("masks exactly the selected indexes using the injected rng", () => {
    // 유구무언 → 인덱스 2("무")만 선택하도록 고정된 rng를 주입한다.
    const rng = () => 2 / 4; // pool 크기 4에서 floor(0.5*4)=2번째 인덱스를 선택
    expect(maskWord("유구무언", "easy", rng)).toBe("유구ㅁ언");
  });

  it("masks all but one syllable on hard, leaving the last-picked one as a hint", () => {
    expect(maskWord("유구무언", "hard", () => 0)).toBe("ㅇㄱㅁ언");
  });

  it("leaves non-Hangul characters such as spaces untouched", () => {
    const result = maskWord("가 나", "hard", () => 0);
    expect(result).toBe("ㄱ 나");
  });
});

describe("maskWordWithIndexes", () => {
  it("reports the exact indexes it masked", () => {
    const { masked, maskedIndexes } = maskWordWithIndexes("유구무언", "easy", () => 2 / 4);
    expect(masked).toBe("유구ㅁ언");
    expect(maskedIndexes).toEqual([2]);
  });
});

describe("reverseSyllables", () => {
  it("reverses syllable order", () => {
    expect(reverseSyllables("박수")).toBe("수박");
  });
});

describe("isCorrectAnswer", () => {
  it("matches after trimming surrounding and internal whitespace", () => {
    expect(isCorrectAnswer(" 유구무언 ", "유구무언")).toBe(true);
    expect(isCorrectAnswer("유 구 무 언", "유구무언")).toBe(true);
  });

  it("rejects a different word", () => {
    expect(isCorrectAnswer("유구무의", "유구무언")).toBe(false);
  });
});
