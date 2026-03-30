import type { AccelerationSample, DisplayTransform, SensorPoint } from './types';

export const EDGE_TILT_DEG = 45;
export const INPUT_TILT_CLAMP_DEG = 70;
export const RAW_JUMP_REJECT_DEG = 28;
export const AXIS_STEP_LIMIT = 0.2;
export const AXIS_DEADZONE_DEG = 1.2;
export const CURSOR_PARAMS = {
  heightRatio: 0.55,
  velDecay: 0.9,
  displayRadiusMeters: 0.05,
  gravity: 9.81,
} as const;

export const AXIS_MAPPING = {
  x: 'beta',
  y: 'gamma',
} as const;

export const AXIS_SIGNS = {
  x: 1,
  y: 1,
} as const;

export const ACCEL_BODY_MAPPING = {
  // bodyX: 左(-) / 右(+), bodyY: 前(-) / 後(+)
  x: { sourceAxis: 'y', sign: 1 },
  y: { sourceAxis: 'x', sign: -1 },
} as const;

export const MAX_RADIUS = 1;

export type CursorComputeInput = {
  orientationEvent: DeviceOrientationEvent;
  calibration: SensorPoint;
  axisTransform: DisplayTransform;
  previousCursor: SensorPoint;
  previousVelocityLike: SensorPoint;
  accelBodyFrame: SensorPoint | null;
  dtSec: number;
  bodyHeightMeters: number;
};

export type CursorComputeOutput = {
  cursor: SensorPoint;
  rawComposite: SensorPoint;
  tiltOnly: SensorPoint;
  velocityLike: SensorPoint;
  mode: 'tilt_only' | 'tilt_plus_accel';
};

export function mapOrientation(event: DeviceOrientationEvent): SensorPoint {
  const beta = normalizeAngle(event.beta ?? 0);
  const gamma = normalizeAngle(event.gamma ?? 0);

  const axisValue = { beta, gamma };

  return {
    x: axisValue[AXIS_MAPPING.x],
    y: axisValue[AXIS_MAPPING.y],
  };
}

export function pointFromOrientation(
  event: DeviceOrientationEvent,
  calibration: SensorPoint,
): SensorPoint {
  const { xDegSigned, yDegSigned } = getTiltDegrees(event, calibration);

  const normalized = {
    x: normalizeToDisplayRange(xDegSigned),
    y: normalizeToDisplayRange(yDegSigned),
  };

  return limitToCircle(normalized, MAX_RADIUS);
}

export function applyDisplayTransform(point: SensorPoint, transform: DisplayTransform): SensorPoint {
  const swapped = transform.swapXY
    ? { x: point.y, y: point.x }
    : { x: point.x, y: point.y };

  return {
    x: transform.invertX ? -swapped.x : swapped.x,
    y: transform.invertY ? -swapped.y : swapped.y,
  };
}

export function inferDisplayTransform(leftTiltDelta: SensorPoint, forwardTiltDelta: SensorPoint): DisplayTransform {
  const candidates: DisplayTransform[] = [];

  for (const swapXY of [false, true]) {
    for (const invertX of [false, true]) {
      for (const invertY of [false, true]) {
        candidates.push({ swapXY, invertX, invertY });
      }
    }
  }

  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const left = applyDisplayTransform(leftTiltDelta, candidate);
    const forward = applyDisplayTransform(forwardTiltDelta, candidate);

    let score = 0;
    // 左傾きは「左へ」= xが負、かつ横方向が優位。
    if (left.x < 0) score += 2;
    score += Math.abs(left.x) - Math.abs(left.y);
    // 前傾きは「上へ」= yが負、かつ縦方向が優位。
    if (forward.y < 0) score += 2;
    score += Math.abs(forward.y) - Math.abs(forward.x);

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function shouldRejectRawJump(currentRaw: SensorPoint, previousRaw: SensorPoint, maxDeltaDeg: number) {
  if (!isFinitePoint(currentRaw) || !isFinitePoint(previousRaw)) {
    return true;
  }

  const deltaX = Math.abs(angularDelta(currentRaw.x, previousRaw.x));
  const deltaY = Math.abs(angularDelta(currentRaw.y, previousRaw.y));
  return Math.hypot(deltaX, deltaY) > maxDeltaDeg;
}

export function smoothPoint(next: SensorPoint, prev: SensorPoint, alphaX: number, alphaY: number): SensorPoint {
  const wx = clamp(alphaX, 0, 1);
  const wy = clamp(alphaY, 0, 1);

  const limitedNext = {
    x: prev.x + capDelta(next.x - prev.x, AXIS_STEP_LIMIT),
    y: prev.y + capDelta(next.y - prev.y, AXIS_STEP_LIMIT),
  };

  return limitToCircle(
    {
      x: prev.x + (limitedNext.x - prev.x) * wx,
      y: prev.y + (limitedNext.y - prev.y) * wy,
    },
    MAX_RADIUS,
  );
}

export function composeCursorPoint(input: CursorComputeInput): CursorComputeOutput {
  const tiltBodyFrame = pointFromOrientation(input.orientationEvent, input.calibration);
  const tiltOnlyNormalized = applyDisplayTransform(tiltBodyFrame, input.axisTransform);
  const { xDegSigned, yDegSigned } = getTiltDegrees(input.orientationEvent, input.calibration);
  const theta = {
    x: (xDegSigned * Math.PI) / 180,
    y: (yDegSigned * Math.PI) / 180,
  };
  const h = CURSOR_PARAMS.heightRatio * input.bodyHeightMeters;
  const tiltBodyMeters = {
    x: h * theta.x,
    y: h * theta.y,
  };
  const tiltDisplayMeters = applyDisplayTransform(tiltBodyMeters, input.axisTransform);
  const tiltOnly = limitToCircle(tiltOnlyNormalized, MAX_RADIUS);
  const hasAcceleration = input.accelBodyFrame !== null;
  const dt = clamp(input.dtSec, 1 / 120, 0.1);
  const velDecay = clamp(CURSOR_PARAMS.velDecay, 0, 1);
  const accelerationDisplay = input.accelBodyFrame
    ? applyDisplayTransform(input.accelBodyFrame, input.axisTransform)
    : { x: 0, y: 0 };
  const velocityLike = hasAcceleration
    ? {
        x: velDecay * input.previousVelocityLike.x + accelerationDisplay.x * dt,
        y: velDecay * input.previousVelocityLike.y + accelerationDisplay.y * dt,
      }
    : {
        x: velDecay * input.previousVelocityLike.x,
        y: velDecay * input.previousVelocityLike.y,
      };
  const omega0 = Math.sqrt(CURSOR_PARAMS.gravity / h);

  const rawComposite = limitToCircle(
    hasAcceleration
      ? {
          x: clamp((tiltDisplayMeters.x + velocityLike.x / omega0) / CURSOR_PARAMS.displayRadiusMeters, -1, 1),
          y: clamp((tiltDisplayMeters.y + velocityLike.y / omega0) / CURSOR_PARAMS.displayRadiusMeters, -1, 1),
        }
      : tiltOnly,
    MAX_RADIUS,
  );

  const cursor = rawComposite;

  return {
    cursor,
    rawComposite,
    tiltOnly,
    velocityLike,
    mode: hasAcceleration ? 'tilt_plus_accel' : 'tilt_only',
  };
}

export function mapAccelerationToBodyFrame(sample: AccelerationSample): SensorPoint | null {
  if (sample.x === null || sample.y === null) {
    return null;
  }

  const axisValue = {
    x: sample.x,
    y: sample.y,
    z: sample.z ?? 0,
  };

  return {
    x: axisValue[ACCEL_BODY_MAPPING.x.sourceAxis] * ACCEL_BODY_MAPPING.x.sign,
    y: axisValue[ACCEL_BODY_MAPPING.y.sourceAxis] * ACCEL_BODY_MAPPING.y.sign,
  };
}

function normalizeToDisplayRange(valueDeg: number): number {
  return clamp(valueDeg / EDGE_TILT_DEG, -1, 1);
}

function applyDeadzone(valueDeg: number, deadzoneDeg: number): number {
  if (Math.abs(valueDeg) <= deadzoneDeg) {
    return 0;
  }
  return Math.sign(valueDeg) * (Math.abs(valueDeg) - deadzoneDeg);
}

function getTiltDegrees(event: DeviceOrientationEvent, calibration: SensorPoint) {
  const mapped = mapOrientation(event);
  const dxDeg = clamp(angularDelta(mapped.x, calibration.x), -INPUT_TILT_CLAMP_DEG, INPUT_TILT_CLAMP_DEG);
  const dyDeg = clamp(angularDelta(mapped.y, calibration.y), -INPUT_TILT_CLAMP_DEG, INPUT_TILT_CLAMP_DEG);

  return {
    xDegSigned: applyDeadzone(dxDeg * AXIS_SIGNS.x, AXIS_DEADZONE_DEG),
    yDegSigned: applyDeadzone(dyDeg * AXIS_SIGNS.y, AXIS_DEADZONE_DEG),
  };
}

function capDelta(delta: number, maxStep: number): number {
  if (Math.abs(delta) <= maxStep) {
    return delta;
  }
  return Math.sign(delta) * maxStep;
}

export function distanceFromCenter(point: SensorPoint) {
  return Math.sqrt(point.x * point.x + point.y * point.y);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function angularDelta(current: number, base: number) {
  return normalizeAngle(current - base);
}

function normalizeAngle(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized;
}

function limitToCircle(point: SensorPoint, maxRadius: number): SensorPoint {
  const radius = distanceFromCenter(point);
  if (radius <= maxRadius) return point;

  const scale = maxRadius / radius;
  return {
    x: clamp(point.x * scale, -maxRadius, maxRadius),
    y: clamp(point.y * scale, -maxRadius, maxRadius),
  };
}

function isFinitePoint(point: SensorPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
