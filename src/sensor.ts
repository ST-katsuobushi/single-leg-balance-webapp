import type { SensorPoint } from './types';

export const SENSOR_SENSITIVITY_X_DEG = 24;
export const SENSOR_SENSITIVITY_Y_DEG = 23;
export const SMOOTHING_ALPHA_X = 0.24;
export const SMOOTHING_ALPHA_Y = 0.34;
export const RAW_JUMP_REJECT_DEG = 30;
export const MAX_TILT_DEG = 65;
export const AXIS_STEP_LIMIT_DEG = 10;

export const AXIS_MAPPING = {
  x: 'beta',
  y: 'gamma',
} as const;

export const AXIS_SIGNS = {
  x: -1,
  y: -1,
} as const;

export const MAX_RADIUS = 0.96;

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

  const dxDeg = clamp(angularDelta(mapped.x, calibration.x), -MAX_TILT_DEG, MAX_TILT_DEG);
  const dyDeg = clamp(angularDelta(mapped.y, calibration.y), -MAX_TILT_DEG, MAX_TILT_DEG);

  const dx = (dxDeg / SENSOR_SENSITIVITY_X_DEG) * AXIS_SIGNS.x;
  const dy = (dyDeg / SENSOR_SENSITIVITY_Y_DEG) * AXIS_SIGNS.y;

  return limitToCircle({ x: dx, y: dy }, MAX_RADIUS);
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
    x: prev.x + clamp(next.x - prev.x, -1, 1) * (AXIS_STEP_LIMIT_DEG / MAX_TILT_DEG),
    y: prev.y + clamp(next.y - prev.y, -1, 1) * (AXIS_STEP_LIMIT_DEG / MAX_TILT_DEG),
  };

  return limitToCircle(
    {
      x: prev.x + (limitedNext.x - prev.x) * wx,
      y: prev.y + (limitedNext.y - prev.y) * wy,
    },
    MAX_RADIUS,
  );
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
