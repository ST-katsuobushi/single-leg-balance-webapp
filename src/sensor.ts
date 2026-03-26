import type { SensorPoint } from './types';

// 後から調整しやすいよう、感度・軸設定を定数化
export const SENSOR_SENSITIVITY_DEG = 20;
export const AXIS_SIGNS = {
  x: 1,
  y: -1,
} as const;
export const MAX_RADIUS = 0.96;

/**
 * DeviceOrientation から最小限の 2D 揺れ指標を作る。
 * 端末を横向き保持（ただし画面は縦固定）した利用を前提に、
 * 体感的に直感へ寄せた軸変換を行う。
 */
export function pointFromOrientation(
  event: DeviceOrientationEvent,
  calibration: SensorPoint,
): SensorPoint {
  const rawGamma = event.gamma ?? 0;
  const rawBeta = event.beta ?? 0;

  // キャリブレーションとの差分で現在位置を決定
  const dx = ((rawGamma - calibration.x) / SENSOR_SENSITIVITY_DEG) * AXIS_SIGNS.x;
  const dy = ((rawBeta - calibration.y) / SENSOR_SENSITIVITY_DEG) * AXIS_SIGNS.y;

  // 画面外に出ないよう円内に制限
  return limitToCircle({ x: dx, y: dy }, MAX_RADIUS);
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
