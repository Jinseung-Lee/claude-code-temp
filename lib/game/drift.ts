/**
 * 싱글모드에서 문제 상자가 화면 안을 돌아다니는 움직임.
 *
 * 위치와 속도는 컨테이너 크기에 대한 백분율(%)로 다룬다. 픽셀이 아니라
 * %로 두면 화면 크기가 달라져도 같은 비율로 움직이고, 반응형 레이아웃에서
 * 경계 판정이 어긋나지 않는다.
 */

/** 초당 이동 거리(%) 범위. 문제마다 이 안에서 뽑는다. */
export const SPEED_MIN_PCT_PER_SEC = 4;
export const SPEED_MAX_PCT_PER_SEC = 11;

/**
 * 상자 크기를 아직 재지 못했을 때 쓰는 이동 범위 여백(%).
 *
 * 좌표는 상자 좌상단 기준이므로, 상자 폭·높이를 알면 그만큼 범위를 좁혀야
 * 오른쪽·아래쪽 벽을 넘지 않는다. 첫 프레임처럼 크기를 재기 전에는 이 값으로
 * 대략 잡아 두고, 측정되면 `boundsFor`가 실제 크기를 반영한다.
 */
export const EDGE_MARGIN_X_PCT = 2;
export const EDGE_MARGIN_Y_PCT = 4;

/** 한 축의 이동 가능 범위. 좌상단 좌표가 이 사이에 머문다. */
export interface AxisBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 상자 크기(px)와 컨테이너 크기(px)로 좌상단 좌표의 이동 범위(%)를 구한다.
 * 크기를 모르면(0 이하) 기본 여백으로 물러난다.
 */
export function boundsFor(
  boxWidth: number,
  boxHeight: number,
  containerWidth: number,
  containerHeight: number,
): AxisBounds {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return {
      minX: EDGE_MARGIN_X_PCT,
      maxX: 100 - EDGE_MARGIN_X_PCT,
      minY: EDGE_MARGIN_Y_PCT,
      maxY: 100 - EDGE_MARGIN_Y_PCT,
    };
  }

  // 상자가 컨테이너보다 크면 범위가 뒤집히므로, 최소값으로 눌러 고정한다.
  const maxX = Math.max(EDGE_MARGIN_X_PCT, 100 - (boxWidth / containerWidth) * 100);
  const maxY = Math.max(EDGE_MARGIN_Y_PCT, 100 - (boxHeight / containerHeight) * 100);

  return { minX: 0, maxX, minY: 0, maxY };
}

/** 화면 안을 돌아다니는 문제 하나. */
export interface DriftingWord {
  id: string;
  answer: string;
  masked: string;
  /** 컨테이너 기준 상자 중심 위치(%). */
  x: number;
  y: number;
  /** 초당 이동량(%). 벽에 닿으면 부호가 뒤집힌다. */
  vx: number;
  vy: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

/**
 * 진행 방향을 무작위로 잡는다. 각도를 균일하게 뽑으므로 속력은 유지되고
 * 방향만 달라진다.
 */
export function randomVelocity(random: () => number = Math.random): Velocity {
  const speed =
    SPEED_MIN_PCT_PER_SEC + random() * (SPEED_MAX_PCT_PER_SEC - SPEED_MIN_PCT_PER_SEC);
  const angle = random() * Math.PI * 2;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

export interface AxisStep {
  next: number;
  velocity: number;
}

/**
 * 한 축의 위치를 갱신하고, 경계를 넘으면 되돌려 반사한다.
 *
 * 넘어간 만큼을 반대로 접어 넣는다. 단순히 경계에 붙이기만 하면 다음 틱에
 * 다시 넘어가 벽에서 떨리기 때문이다. 속도가 폭보다 커서 접어도 범위를
 * 벗어나는 경우에는 안쪽으로 붙인다.
 */
export function bounceAxis(
  position: number,
  velocity: number,
  deltaSec: number,
  min: number,
  max: number,
): AxisStep {
  let next = position + velocity * deltaSec;
  let nextVelocity = velocity;

  if (next < min) {
    next = min + (min - next);
    nextVelocity = Math.abs(velocity);
  } else if (next > max) {
    next = max - (next - max);
    nextVelocity = -Math.abs(velocity);
  }

  return { next: Math.min(max, Math.max(min, next)), velocity: nextVelocity };
}

/** 크기를 재기 전에 쓰는 기본 이동 범위. */
export const DEFAULT_BOUNDS: AxisBounds = {
  minX: EDGE_MARGIN_X_PCT,
  maxX: 100 - EDGE_MARGIN_X_PCT,
  minY: EDGE_MARGIN_Y_PCT,
  maxY: 100 - EDGE_MARGIN_Y_PCT,
};

/**
 * 문제 하나를 한 틱 움직인다. 가로·세로를 각각 반사 판정한다.
 * `bounds`는 상자 크기를 반영한 범위이며, 없으면 기본 여백을 쓴다.
 */
export function stepWord<T extends DriftingWord>(
  word: T,
  deltaSec: number,
  bounds: AxisBounds = DEFAULT_BOUNDS,
): T {
  const horizontal = bounceAxis(word.x, word.vx, deltaSec, bounds.minX, bounds.maxX);
  const vertical = bounceAxis(word.y, word.vy, deltaSec, bounds.minY, bounds.maxY);

  return {
    ...word,
    x: horizontal.next,
    y: vertical.next,
    vx: horizontal.velocity,
    vy: vertical.velocity,
  };
}
