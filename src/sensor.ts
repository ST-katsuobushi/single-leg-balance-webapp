import type { SensorPoint } from './types';

export const EDGE_TILT_DEG = 45;
export const INPUT_TILT_CLAMP_DEG = 70;
export const SENSOR_SENSITIVITY_X_DEG = 18;
export const SENSOR_SENSITIVITY_Y_FORWARD_DEG = 24;
export const SENSOR_SENSITIVITY_Y_BACKWARD_DEG = 34;
export const SMOOTHING_ALPHA_X = 0.36;
export const SMOOTHING_ALPHA_Y = 0.28;
export const RAW_JUMP_REJECT_DEG = 30;
export const AXIS_STEP_LIMIT_X = 0.24;
export const AXIS_STEP_LIMIT_Y = 0.14;
export const AXIS_STEP_LIMIT_Y_FORWARD = 0.09;
export const AXIS_STEP_LIMIT_Y_BACKWARD = 0.07;

export const AXIS_MAPPING = {
  x: 'gamma',
  y: 'beta',
} as const;

export const AXIS_SIGNS = {
  x: 1,
  y: -1,
} as const;

export const MAX_RADIUS = 1;

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
  const mapped = mapOrientation(event);

  const dxDeg = clamp(angularDelta(mapped.x, calibration.x), -INPUT_TILT_CLAMP_DEG, INPUT_TILT_CLAMP_DEG);
  const dyDeg = clamp(angularDelta(mapped.y, calibration.y), -INPUT_TILT_CLAMP_DEG, INPUT_TILT_CLAMP_DEG);

  const xDegSigned = dxDeg * AXIS_SIGNS.x;
  const yDegSigned = dyDeg * AXIS_SIGNS.y;

  const normalized = {
    x: normalizeToDisplayRange(xDegSigned, EDGE_TILT_DEG / SENSOR_SENSITIVITY_X_DEG),
    y: normalizeToDisplayRange(
      yDegSigned,
      EDGE_TILT_DEG / (yDegSigned < 0 ? SENSOR_SENSITIVITY_Y_BACKWARD_DEG : SENSOR_SENSITIVITY_Y_FORWARD_DEG),
    ),
  };

  return limitToCircle(normalized, MAX_RADIUS);
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

  const stepLimitY = next.y < prev.y ? AXIS_STEP_LIMIT_Y_FORWARD : AXIS_STEP_LIMIT_Y_BACKWARD;
  const limitedNext = {
    x: prev.x + capDelta(next.x - prev.x, AXIS_STEP_LIMIT_X),
    y: prev.y + capDelta(next.y - prev.y, Math.min(AXIS_STEP_LIMIT_Y, stepLimitY)),
  };

  return limitToCircle(
    {
      x: prev.x + (limitedNext.x - prev.x) * wx,
      y: prev.y + (limitedNext.y - prev.y) * wy,
    },
    MAX_RADIUS,
  );
}

function normalizeToDisplayRange(valueDeg: number, gain = 1): number {
  return clamp((valueDeg / EDGE_TILT_DEG) * gain, -1, 1);
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
