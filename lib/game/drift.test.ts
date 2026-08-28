import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOUNDS,
  EDGE_MARGIN_X_PCT,
  EDGE_MARGIN_Y_PCT,
  SPEED_MAX_PCT_PER_SEC,
  SPEED_MIN_PCT_PER_SEC,
  boundsFor,
  bounceAxis,
  randomVelocity,
  stepWord,
  type DriftingWord,
} from "./drift";

function makeWord(overrides: Partial<DriftingWord> = {}): DriftingWord {
  return {
    id: "w1",
    answer: "유구무언",
    masked: "유구ㅁ언",
    x: 50,
    y: 50,
    vx: 10,
    vy: 10,
    ...overrides,
  };
}

describe("bounceAxis", () => {
  it("경계 안에서는 속도만큼 이동한다", () => {
    const step = bounceAxis(50, 10, 0.5, 0, 100);
    expect(step.next).toBe(55);
    expect(step.velocity).toBe(10);
  });

  it("최대 경계를 넘으면 반사해 되돌아온다", () => {
    // 98에서 +10%/초로 1초 → 108이므로 100을 8 넘는다. 100-8 = 92로 접힌다.
    const step = bounceAxis(98, 10, 1, 0, 100);
    expect(step.next).toBe(92);
    expect(step.velocity).toBe(-10);
  });

  it("최소 경계를 넘으면 반사해 되돌아온다", () => {
    const step = bounceAxis(2, -10, 1, 0, 100);
    expect(step.next).toBe(8);
    expect(step.velocity).toBe(10);
  });

  it("반사 후에도 경계를 벗어나지 않는다", () => {
    // 속도가 폭보다 큰 극단적인 경우에도 범위 안에 머문다.
    const step = bounceAxis(50, 10_000, 1, 40, 60);
    expect(step.next).toBeGreaterThanOrEqual(40);
    expect(step.next).toBeLessThanOrEqual(60);
  });

  it("경계에 정확히 닿으면 반사하지 않는다", () => {
    const step = bounceAxis(90, 10, 1, 0, 100);
    expect(step.next).toBe(100);
    expect(step.velocity).toBe(10);
  });
});

describe("stepWord", () => {
  it("가로·세로를 함께 움직인다", () => {
    const moved = stepWord(makeWord({ x: 50, y: 50, vx: 10, vy: -20 }), 0.5);
    expect(moved.x).toBe(55);
    expect(moved.y).toBe(40);
  });

  it("answer와 masked는 그대로 유지한다", () => {
    const moved = stepWord(makeWord(), 0.5);
    expect(moved.answer).toBe("유구무언");
    expect(moved.masked).toBe("유구ㅁ언");
    expect(moved.id).toBe("w1");
  });

  it("오래 굴려도 화면 밖으로 나가지 않는다", () => {
    // 여러 방향·속도로 1000틱을 굴려, 경계 이탈이 없는지 확인한다.
    const words = [
      makeWord({ id: "a", vx: 11, vy: 11 }),
      makeWord({ id: "b", x: 5, y: 8, vx: -11, vy: -11 }),
      makeWord({ id: "c", x: 96, y: 93, vx: 9, vy: -4 }),
    ];

    let current = words;
    for (let i = 0; i < 1000; i += 1) {
      current = current.map((w) => stepWord(w, 0.06));
      for (const w of current) {
        expect(w.x).toBeGreaterThanOrEqual(EDGE_MARGIN_X_PCT);
        expect(w.x).toBeLessThanOrEqual(100 - EDGE_MARGIN_X_PCT);
        expect(w.y).toBeGreaterThanOrEqual(EDGE_MARGIN_Y_PCT);
        expect(w.y).toBeLessThanOrEqual(100 - EDGE_MARGIN_Y_PCT);
      }
    }
  });

  it("벽에 붙어 멈추지 않고 계속 움직인다", () => {
    // 벽에 닿은 뒤에도 위치가 계속 바뀌어야 한다(떨림 없이 되돌아온다).
    let word = makeWord({ x: 96, y: 50, vx: 10, vy: 0 });
    const positions = new Set<number>();
    for (let i = 0; i < 30; i += 1) {
      word = stepWord(word, 0.06);
      positions.add(Number(word.x.toFixed(3)));
    }
    expect(positions.size).toBeGreaterThan(5);
  });
});

describe("randomVelocity", () => {
  it("속력이 정해진 범위 안에 있다", () => {
    for (let i = 0; i < 200; i += 1) {
      const { vx, vy } = randomVelocity();
      const speed = Math.hypot(vx, vy);
      expect(speed).toBeGreaterThanOrEqual(SPEED_MIN_PCT_PER_SEC - 1e-9);
      expect(speed).toBeLessThanOrEqual(SPEED_MAX_PCT_PER_SEC + 1e-9);
    }
  });

  it("난수를 주입하면 결과가 결정적이다", () => {
    const fixed = () => 0.5;
    expect(randomVelocity(fixed)).toEqual(randomVelocity(fixed));
  });

  it("한 축만 움직이는 정지 상태를 만들지 않는다", () => {
    for (let i = 0; i < 200; i += 1) {
      const { vx, vy } = randomVelocity();
      expect(Math.hypot(vx, vy)).toBeGreaterThan(0);
    }
  });
});

describe("boundsFor", () => {
  it("상자 폭만큼 오른쪽 범위를 좁힌다", () => {
    // 컨테이너 800px, 상자 200px → 상자 폭이 25%이므로 최대 75%까지만 간다.
    const bounds = boundsFor(200, 40, 800, 400);
    expect(bounds.maxX).toBeCloseTo(75);
    expect(bounds.maxY).toBeCloseTo(90);
    expect(bounds.minX).toBe(0);
  });

  it("컨테이너 크기를 모르면 기본 여백으로 물러난다", () => {
    expect(boundsFor(200, 40, 0, 0)).toEqual(DEFAULT_BOUNDS);
  });

  it("상자가 컨테이너보다 커도 범위가 뒤집히지 않는다", () => {
    const bounds = boundsFor(1200, 500, 800, 400);
    expect(bounds.maxX).toBeGreaterThanOrEqual(bounds.minX);
    expect(bounds.maxY).toBeGreaterThanOrEqual(bounds.minY);
  });

  it("좁힌 범위로 굴리면 상자가 오른쪽 벽을 넘지 않는다", () => {
    // 컨테이너 800px에 상자 300px(37.5%). 좌상단이 62.5%를 넘으면 잘린다.
    const bounds = boundsFor(300, 40, 800, 400);
    let word = makeWord({ x: 60, y: 50, vx: 11, vy: 0 });
    for (let i = 0; i < 500; i += 1) {
      word = stepWord(word, 0.06, bounds);
      expect(word.x).toBeLessThanOrEqual(bounds.maxX + 1e-9);
      // 실제 픽셀로도 컨테이너를 넘지 않는지 확인한다.
      expect((word.x / 100) * 800 + 300).toBeLessThanOrEqual(800 + 1e-6);
    }
  });
});
