import type { SensorPoint } from './types';

/**
 * DeviceOrientation から最小限の 2D 揺れ指標を作る。
 * 横向き運用を想定し、gamma/beta 差分を正規化して利用する。
 */
export function pointFromOrientation(
  event: DeviceOrientationEvent,
  calibration: SensorPoint,
): SensorPoint {
  const rawX = event.gamma ?? 0;
  const rawY = event.beta ?? 0;

  // キャリブレーションとの差分で現在位置を決定
  const dx = (rawX - calibration.x) / 35;
  const dy = (rawY - calibration.y) / 35;

  // 画面外に飛びすぎないよう制限
  return {
    x: clamp(dx, -1.2, 1.2),
    y: clamp(dy, -1.2, 1.2),
  };
}

export function distanceFromCenter(point: SensorPoint) {
  return Math.sqrt(point.x * point.x + point.y * point.y);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
