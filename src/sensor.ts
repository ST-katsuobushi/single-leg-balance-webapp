import type { SensorPoint } from './types';

export const SENSOR_SENSITIVITY_DEG = 24;
export const SMOOTHING_ALPHA = 0.25;
export const RAW_JUMP_REJECT_DEG = 22;
export const MAX_TILT_DEG = 65;

export const AXIS_MAPPING = {
  x: 'gamma',
  y: 'beta',
} as const;

export const AXIS_SIGNS = {
  x: 1,
  y: -1,
} as const;

export const MAX_RADIUS = 0.96;

export function mapOrientation(event: DeviceOrientationEvent): SensorPoint {
  const beta = clamp(event.beta ?? 0, -MAX_TILT_DEG, MAX_TILT_DEG);
  const gamma = clamp(event.gamma ?? 0, -MAX_TILT_DEG, MAX_TILT_DEG);

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

  const dx = ((mapped.x - calibration.x) / SENSOR_SENSITIVITY_DEG) * AXIS_SIGNS.x;
  const dy = ((mapped.y - calibration.y) / SENSOR_SENSITIVITY_DEG) * AXIS_SIGNS.y;

  return limitToCircle({ x: dx, y: dy }, MAX_RADIUS);
}

export function shouldRejectRawJump(currentRaw: SensorPoint, previousRaw: SensorPoint, maxDeltaDeg: number) {
  if (!isFinitePoint(currentRaw) || !isFinitePoint(previousRaw)) {
    return true;
  }

  return (
    Math.abs(currentRaw.x - previousRaw.x) > maxDeltaDeg ||
    Math.abs(currentRaw.y - previousRaw.y) > maxDeltaDeg
  );
}

export function smoothPoint(next: SensorPoint, prev: SensorPoint, alpha: number): SensorPoint {
  const w = clamp(alpha, 0, 1);
  return limitToCircle({
    x: prev.x + (next.x - prev.x) * w,
    y: prev.y + (next.y - prev.y) * w,
  }, MAX_RADIUS);
}

export function distanceFromCenter(point: SensorPoint) {
  return Math.sqrt(point.x * point.x + point.y * point.y);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
