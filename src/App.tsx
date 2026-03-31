import { useEffect, useMemo, useRef, useState } from 'react';
import { appendSessionLog, loadSettings, saveSettings } from './storage';
import {
  RAW_JUMP_REJECT_DEG,
  composeCursorPoint,
  distanceFromCenter,
  inferDisplayTransform,
  mapAccelerationToBodyFrame,
  mapOrientation,
  shouldRejectRawJump,
} from './sensor';
import type {
  AccelerationSample,
  DurationOption,
  Leg,
  Screen,
  SensorPoint,
  SessionLog,
  Settings,
} from './types';

const DURATION_OPTIONS: DurationOption[] = [20, 30, 60];
const TARGET_RADIUS = 0.4;
const DIRECTION_CALIB_MIN_DELTA_DEG = 3;
const ACC_VALID_WINDOW = 12;
const ACC_VALID_MIN_COUNT = 8;
const INTERVAL_AVG_WINDOW = 8;
const PORTRAIT_LOCK_MESSAGE = '画面回転ロックをONにしてください';
const HEIGHT_MIN_CM = 120;
const HEIGHT_MAX_CM = 220;

type DeviceOrientationEventWithPermission = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function App() {
  const [screen, setScreen] = useState<Screen>('start');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [heightCmInput, setHeightCmInput] = useState<string>('');
  const [countdown, setCountdown] = useState(3);
  const [remainingSec, setRemainingSec] = useState<number>(settings.durationSec);
  const [position, setPosition] = useState<SensorPoint>({ x: 0, y: 0 });
  const [rawOrientation, setRawOrientation] = useState<SensorPoint>({ x: 0, y: 0 });
  const [rawAcceleration, setRawAcceleration] = useState<AccelerationSample>({ x: null, y: null, z: null });
  const [calibration, setCalibration] = useState<SensorPoint | null>(null);
  const [permissionError, setPermissionError] = useState<string>('');
  const [directionCalibStep, setDirectionCalibStep] = useState<'left' | 'forward' | 'confirm'>('left');
  const [directionCalibError, setDirectionCalibError] = useState<string>('');
  const [leftTiltSample, setLeftTiltSample] = useState<SensorPoint | null>(null);
  const [isPortraitViewport, setIsPortraitViewport] = useState(() =>
    window.matchMedia('(orientation: portrait)').matches,
  );

  const startMsRef = useRef<number | null>(null);
  const swayValuesRef = useRef<number[]>([]);
  const inTargetCountRef = useRef(0);
  const totalCountRef = useRef(0);
  const previousRawRef = useRef<SensorPoint | null>(null);
  const filteredPointRef = useRef<SensorPoint>({ x: 0, y: 0 });
  const velocityLikeRef = useRef<SensorPoint>({ x: 0, y: 0 });
  const previousOrientationTsRef = useRef<number | null>(null);
  const motionIntervalSecRef = useRef<number | null>(null);
  const motionIntervalWindowRef = useRef<number[]>([]);
  const orientationIntervalWindowRef = useRef<number[]>([]);
  const previousOrientationEventTsRef = useRef<number | null>(null);
  const [motionSamplingHz, setMotionSamplingHz] = useState<number | null>(null);
  const [orientationSamplingHz, setOrientationSamplingHz] = useState<number | null>(null);
  const [hasOrientationEvent, setHasOrientationEvent] = useState(false);
  const [accelerationSupported, setAccelerationSupported] = useState(false);
  const sensorCheckCalibrationRef = useRef<SensorPoint | null>(null);
  const accValidWindowRef = useRef<boolean[]>([]);
  const targetAreaRef = useRef<HTMLDivElement | null>(null);
  const [targetRadiusPx, setTargetRadiusPx] = useState(0);

  useEffect(() => {
    setHeightCmInput(settings.heightMeters === null ? '' : String(Math.round(settings.heightMeters * 100)));
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(orientation: portrait)');
    const update = () => setIsPortraitViewport(media.matches);

    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (!isPortraitViewport && screen !== 'start') {
      setScreen('start');
      setCalibration(null);
      setPosition({ x: 0, y: 0 });
      setDirectionCalibStep('left');
      setDirectionCalibError('');
      setLeftTiltSample(null);
      previousRawRef.current = null;
      filteredPointRef.current = { x: 0, y: 0 };
      velocityLikeRef.current = { x: 0, y: 0 };
      previousOrientationTsRef.current = null;
      motionIntervalSecRef.current = null;
      motionIntervalWindowRef.current = [];
      orientationIntervalWindowRef.current = [];
      previousOrientationEventTsRef.current = null;
      setMotionSamplingHz(null);
      setOrientationSamplingHz(null);
      setRawAcceleration({ x: null, y: null, z: null });
      setAccelerationSupported(false);
      sensorCheckCalibrationRef.current = null;
      accValidWindowRef.current = [];
      setPermissionError('');
    }
  }, [isPortraitViewport, screen]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const element = targetAreaRef.current;
    if (!element) return;

    const updateRadius = () => {
      const rect = element.getBoundingClientRect();
      setTargetRadiusPx(Math.min(rect.width, rect.height) / 2);
    };

    updateRadius();

    const observer = new ResizeObserver(updateRadius);
    observer.observe(element);
    window.addEventListener('resize', updateRadius);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateRadius);
    };
  }, [screen]);

  useEffect(() => {
    const handleMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.acceleration;
      const next = {
        x: acceleration?.x ?? null,
        y: acceleration?.y ?? null,
        z: acceleration?.z ?? null,
      };
      setRawAcceleration(next);

      const hasAcc = next.x !== null && next.y !== null;
      const windowBuffer = [...accValidWindowRef.current, hasAcc].slice(-ACC_VALID_WINDOW);
      accValidWindowRef.current = windowBuffer;
      const validCount = windowBuffer.filter(Boolean).length;
      setAccelerationSupported(validCount >= ACC_VALID_MIN_COUNT);

      if (typeof event.interval === 'number' && Number.isFinite(event.interval) && event.interval > 0) {
        motionIntervalSecRef.current = event.interval / 1000;
        const intervalWindow = [...motionIntervalWindowRef.current, event.interval].slice(-INTERVAL_AVG_WINDOW);
        motionIntervalWindowRef.current = intervalWindow;
        const avgIntervalMs = intervalWindow.reduce((sum, ms) => sum + ms, 0) / intervalWindow.length;
        setMotionSamplingHz(1000 / avgIntervalMs);
      }
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, []);

  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      setHasOrientationEvent(true);
      const latestRaw = mapOrientation(event);
      setRawOrientation(latestRaw);

      const currentEventTs = typeof event.timeStamp === 'number' ? event.timeStamp : performance.now();
      if (previousOrientationEventTsRef.current !== null) {
        const intervalMs = currentEventTs - previousOrientationEventTsRef.current;
        if (Number.isFinite(intervalMs) && intervalMs > 0) {
          const intervalWindow = [...orientationIntervalWindowRef.current, intervalMs].slice(-INTERVAL_AVG_WINDOW);
          orientationIntervalWindowRef.current = intervalWindow;
          const avgIntervalMs = intervalWindow.reduce((sum, ms) => sum + ms, 0) / intervalWindow.length;
          setOrientationSamplingHz(1000 / avgIntervalMs);
        }
      }
      previousOrientationEventTsRef.current = currentEventTs;

      const activeCalibration = calibration ?? (screen === 'sensor_check' ? sensorCheckCalibrationRef.current : null);
      if (!activeCalibration) {
        if (screen === 'sensor_check') {
          sensorCheckCalibrationRef.current = latestRaw;
        }
        return;
      }

      if (
        previousRawRef.current &&
        shouldRejectRawJump(latestRaw, previousRawRef.current, RAW_JUMP_REJECT_DEG)
      ) {
        previousRawRef.current = latestRaw;
        return;
      }

      const accelBodyFrame = accelerationSupported
        ? mapAccelerationToBodyFrame(rawAcceleration)
        : null;
      if (settings.heightMeters === null) {
        return;
      }
      const currentTsMs = typeof event.timeStamp === 'number' ? event.timeStamp : performance.now();
      const fallbackDtSec =
        previousOrientationTsRef.current === null
          ? 1 / 60
          : (currentTsMs - previousOrientationTsRef.current) / 1000;
      const dtSec = motionIntervalSecRef.current ?? fallbackDtSec;
      previousOrientationTsRef.current = currentTsMs;

      const composed = composeCursorPoint({
        orientationEvent: event,
        calibration: activeCalibration,
        axisTransform: settings.displayTransform,
        previousCursor: filteredPointRef.current,
        previousVelocityLike: velocityLikeRef.current,
        accelBodyFrame,
        dtSec,
        bodyHeightMeters: settings.heightMeters,
      });
      filteredPointRef.current = composed.cursor;
      velocityLikeRef.current = composed.velocityLike;
      previousRawRef.current = latestRaw;
      setPosition(composed.cursor);

      if (screen === 'training') {
        const d = distanceFromCenter(composed.cursor);
        swayValuesRef.current.push(d);
        totalCountRef.current += 1;
        if (d <= TARGET_RADIUS) {
          inTargetCountRef.current += 1;
        }
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [calibration, rawAcceleration.x, rawAcceleration.y, screen, settings.displayTransform, settings.heightMeters]);

  useEffect(() => {
    if (screen !== 'countdown') return;

    if (countdown === 0) {
      setScreen('training');
      setRemainingSec(settings.durationSec);
      startMsRef.current = Date.now();
      swayValuesRef.current = [];
      inTargetCountRef.current = 0;
      totalCountRef.current = 0;
      return;
    }

    const timer = window.setTimeout(() => setCountdown((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, screen, settings.durationSec]);

  useEffect(() => {
    if (screen !== 'training') return;

    if (remainingSec <= 0) {
      finishSession(true);
      return;
    }

    const timer = window.setTimeout(() => setRemainingSec((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [screen, remainingSec]);

  const meanSway = useMemo(() => {
    const arr = swayValuesRef.current;
    if (arr.length === 0) return 0;
    const sum = arr.reduce((a, b) => a + b, 0);
    return sum / arr.length;
  }, [screen]);

  const sensorCheckSummary = useMemo(() => {
    const tiltAvailable = hasOrientationEvent;
    const accelAvailable = accelerationSupported;

    if (tiltAvailable && accelAvailable) {
      return {
        title: '使用可',
        detail: '傾き + 加速度で運用可',
        mode: 'tilt + acceleration',
        levelClass: 'ok',
      } as const;
    }

    if (tiltAvailable) {
      return {
        title: '一部使用可',
        detail: '傾きのみで運用可',
        mode: 'tilt only',
        levelClass: 'partial',
      } as const;
    }

    return {
      title: '使用不可',
      detail: 'トレーニング非対応',
      mode: 'unsupported',
      levelClass: 'ng',
    } as const;
  }, [accelerationSupported, hasOrientationEvent]);

  const heightValidationMessage = useMemo(() => {
    const trimmed = heightCmInput.trim();
    if (trimmed.length === 0) return '身長を入力してください。';
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return '身長は数値で入力してください。';

    const cm = Number(trimmed);
    if (!Number.isFinite(cm)) return '身長の入力値が不正です。';
    if (cm < HEIGHT_MIN_CM || cm > HEIGHT_MAX_CM) {
      return `身長は${HEIGHT_MIN_CM}〜${HEIGHT_MAX_CM} cmの範囲で入力してください。`;
    }
    return '';
  }, [heightCmInput]);
  const isHeightValid = heightValidationMessage.length === 0 && settings.heightMeters !== null;

  async function requestMotionPermissionIfNeeded() {
    const anyOrientation = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
    if (typeof anyOrientation.requestPermission === 'function') {
      const result = await anyOrientation.requestPermission();
      if (result !== 'granted') {
        throw new Error('センサー利用が許可されませんでした。');
      }
    }

    const anyMotion = DeviceMotionEvent as unknown as DeviceOrientationEventWithPermission;
    if (typeof anyMotion.requestPermission === 'function') {
      const result = await anyMotion.requestPermission();
      if (result !== 'granted') {
        throw new Error('モーションセンサー利用が許可されませんでした。');
      }
    }
  }

  async function goToPrepare() {
    if (!isPortraitViewport) {
      setPermissionError(PORTRAIT_LOCK_MESSAGE);
      return;
    }
    if (!isHeightValid) {
      setPermissionError(heightValidationMessage || '身長を設定してください。');
      return;
    }

    try {
      setPermissionError('');
      await requestMotionPermissionIfNeeded();
      setCalibration(null);
      setPosition({ x: 0, y: 0 });
      setDirectionCalibStep('left');
      setDirectionCalibError('');
      setLeftTiltSample(null);
      previousRawRef.current = null;
      filteredPointRef.current = { x: 0, y: 0 };
      velocityLikeRef.current = { x: 0, y: 0 };
      previousOrientationTsRef.current = null;
      motionIntervalSecRef.current = null;
      motionIntervalWindowRef.current = [];
      orientationIntervalWindowRef.current = [];
      previousOrientationEventTsRef.current = null;
      setMotionSamplingHz(null);
      setOrientationSamplingHz(null);
      setRawAcceleration({ x: null, y: null, z: null });
      setAccelerationSupported(false);
      sensorCheckCalibrationRef.current = null;
      accValidWindowRef.current = [];
      setScreen('prepare');
    } catch (error) {
      setPermissionError(error instanceof Error ? error.message : '不明なエラーが発生しました。');
    }
  }

  function calibrate() {
    setCalibration({ ...rawOrientation });
    previousRawRef.current = rawOrientation;
    filteredPointRef.current = { x: 0, y: 0 };
    velocityLikeRef.current = { x: 0, y: 0 };
    previousOrientationTsRef.current = null;
    motionIntervalSecRef.current = null;
    motionIntervalWindowRef.current = [];
    orientationIntervalWindowRef.current = [];
    previousOrientationEventTsRef.current = null;
    setMotionSamplingHz(null);
    setOrientationSamplingHz(null);
    setPosition({ x: 0, y: 0 });
    setDirectionCalibStep('left');
    setDirectionCalibError('');
    setLeftTiltSample(null);
    setScreen('direction_calibration');
  }

  function startCountdown() {
    setCountdown(3);
    setScreen('countdown');
  }

  function finishSession(completed: boolean) {
    const now = new Date();
    const elapsedSec = startMsRef.current ? (Date.now() - startMsRef.current) / 1000 : 0;
    const actualDuration = Math.max(0, Math.min(settings.durationSec, elapsedSec));

    const values = swayValuesRef.current;
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length
      ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
      : 0;
    const sd = Math.sqrt(variance);
    const max = values.length ? Math.max(...values) : 0;
    const timeInTargetRatio =
      totalCountRef.current > 0 ? inTargetCountRef.current / totalCountRef.current : 0;

    const log: SessionLog = {
      session_id: crypto.randomUUID(),
      date: now.toISOString(),
      leg: settings.leg,
      target_duration_sec: settings.durationSec,
      actual_duration_sec: Number(actualDuration.toFixed(2)),
      completed,
      calibration_done: calibration !== null,
      mean_sway_index: Number(mean.toFixed(4)),
      sd_sway_index: Number(sd.toFixed(4)),
      max_sway_index: Number(max.toFixed(4)),
      time_in_target_ratio: Number(timeInTargetRatio.toFixed(4)),
    };

    appendSessionLog(log);
    setScreen('finished');
  }

  function goHome() {
    setCalibration(null);
    setPosition({ x: 0, y: 0 });
    setDirectionCalibStep('left');
    setDirectionCalibError('');
    setLeftTiltSample(null);
    previousRawRef.current = null;
    filteredPointRef.current = { x: 0, y: 0 };
    velocityLikeRef.current = { x: 0, y: 0 };
    previousOrientationTsRef.current = null;
    motionIntervalSecRef.current = null;
    motionIntervalWindowRef.current = [];
    orientationIntervalWindowRef.current = [];
    previousOrientationEventTsRef.current = null;
    setMotionSamplingHz(null);
    setOrientationSamplingHz(null);
    sensorCheckCalibrationRef.current = null;
    accValidWindowRef.current = [];
    setAccelerationSupported(false);
    setRemainingSec(settings.durationSec);
    setScreen('start');
  }

  function toggleLeg() {
    const nextLeg: Leg = settings.leg === 'left' ? 'right' : 'left';
    setSettings((prev) => ({ ...prev, leg: nextLeg }));
  }

  function captureDirectionSample() {
    if (!calibration) {
      setDirectionCalibError('先にゼロ校正を行ってください。');
      return;
    }

    const sample = {
      x: rawOrientation.x - calibration.x,
      y: rawOrientation.y - calibration.y,
    };

    if (Math.hypot(sample.x, sample.y) < DIRECTION_CALIB_MIN_DELTA_DEG) {
      setDirectionCalibError('傾き量が小さいです。もう少しだけ傾けてください。');
      return;
    }

    if (directionCalibStep === 'left') {
      setLeftTiltSample(sample);
      setDirectionCalibStep('forward');
      setDirectionCalibError('');
      return;
    }

    if (directionCalibStep === 'forward' && leftTiltSample) {
      const inferred = inferDisplayTransform(leftTiltSample, sample);
      setSettings((prev) => ({ ...prev, displayTransform: inferred }));
      setDirectionCalibStep('confirm');
      setDirectionCalibError('');
    }
  }

  return (
    <main className="viewportRoot">
      {!isPortraitViewport ? (
        <section className="lockMessageCard" role="alert" aria-live="polite">
          <h1>{PORTRAIT_LOCK_MESSAGE}</h1>
          <p>縦長画面でのみ開始できます。</p>
        </section>
      ) : (
        <div className="rotatedShell">
          <div className="rotatedContent">
            <section className="card">
              {screen === 'start' && (
                <>
                  <h1>片脚バランストレーニング</h1>
                  <p className="hint">端末を横向きで両手保持し、画面を天井向きにして開始してください。</p>

                  <label className="label">脚の選択</label>
                  <div className="row">
                    <button
                      className={settings.leg === 'left' ? 'active' : ''}
                      onClick={() => setSettings((prev) => ({ ...prev, leg: 'left' }))}
                    >
                      左脚
                    </button>
                    <button
                      className={settings.leg === 'right' ? 'active' : ''}
                      onClick={() => setSettings((prev) => ({ ...prev, leg: 'right' }))}
                    >
                      右脚
                    </button>
                  </div>

                  <label className="label">時間</label>
                  <div className="row">
                    {DURATION_OPTIONS.map((duration) => (
                      <button
                        key={duration}
                        className={settings.durationSec === duration ? 'active' : ''}
                        onClick={() => setSettings((prev) => ({ ...prev, durationSec: duration }))}
                      >
                        {duration}秒
                      </button>
                    ))}
                  </div>

                  <label className="label" htmlFor="height-cm-input">身長（cm）</label>
                  <input
                    id="height-cm-input"
                    type="number"
                    inputMode="decimal"
                    min={HEIGHT_MIN_CM}
                    max={HEIGHT_MAX_CM}
                    step="0.1"
                    value={heightCmInput}
                    onChange={(event) => {
                      const value = event.target.value;
                      setHeightCmInput(value);
                      const parsedCm = Number(value);
                      const trimmed = value.trim();
                      setSettings((prev) => ({
                        ...prev,
                        heightMeters: trimmed.length > 0 && Number.isFinite(parsedCm) ? parsedCm / 100 : null,
                      }));
                    }}
                  />
                  {heightValidationMessage && <p className="error">{heightValidationMessage}</p>}

                  {permissionError && <p className="error">{permissionError}</p>}
                  <button
                    onClick={async () => {
                      if (!isHeightValid) {
                        setPermissionError(heightValidationMessage || '身長を設定してください。');
                        return;
                      }
                      try {
                        await requestMotionPermissionIfNeeded();
                        setPermissionError('');
                        sensorCheckCalibrationRef.current = null;
                        setScreen('sensor_check');
                      } catch (error) {
                        setPermissionError(error instanceof Error ? error.message : '不明なエラーが発生しました。');
                      }
                    }}
                  >
                    センサ確認モード
                  </button>
                  <button className="primary" onClick={goToPrepare}>
                    開始
                  </button>
                </>
              )}

              {screen === 'sensor_check' && (
                <>
                  <h2>センサ確認モード</h2>
                  <div className="sensorCheckLayout">
                    <div className="sensorCheckPreviewColumn">
                      <div className="sensorPreview" aria-label="sensor cursor preview">
                        <div className="sensorPreviewCircle" />
                        <div
                          className="dot"
                          style={{
                            left: '50%',
                            top: '50%',
                            transform: `translate(-50%, -50%) translate(${(position.x * 50).toFixed(2)}px, ${(position.y * 50).toFixed(2)}px)`,
                          }}
                        />
                      </div>
                      <button
                        className="secondary"
                        onClick={() => {
                          sensorCheckCalibrationRef.current = { ...rawOrientation };
                          filteredPointRef.current = { x: 0, y: 0 };
                          velocityLikeRef.current = { x: 0, y: 0 };
                          previousOrientationTsRef.current = null;
                          motionIntervalSecRef.current = null;
                          motionIntervalWindowRef.current = [];
                          orientationIntervalWindowRef.current = [];
                          previousOrientationEventTsRef.current = null;
                          setMotionSamplingHz(null);
                          setOrientationSamplingHz(null);
                          setPosition({ x: 0, y: 0 });
                        }}
                      >
                        ゼロ再設定
                      </button>
                    </div>

                    <div className="sensorCheckInfoColumn">
                      <div className={`sensorJudgeCard ${sensorCheckSummary.levelClass}`}>
                        <p className="sensorJudgeLabel">判定結果</p>
                        <p className="sensorJudgeTitle">{sensorCheckSummary.title}</p>
                        <p className="sensorJudgeDetail">{sensorCheckSummary.detail}</p>
                      </div>

                      <div className="sensorStatusGrid">
                        <p>傾きセンサ</p>
                        <p>{hasOrientationEvent ? '使用可' : '不可'}</p>
                        <p>加速度センサ</p>
                        <p>{accelerationSupported ? '使用可' : '不可'}</p>
                        <p>推奨モード</p>
                        <p>{sensorCheckSummary.mode}</p>
                        <p>motion 更新頻度</p>
                        <p>{motionSamplingHz === null ? '-' : `${motionSamplingHz.toFixed(2)} Hz`}</p>
                        <p>orientation 更新頻度</p>
                        <p>{orientationSamplingHz === null ? '-' : `${orientationSamplingHz.toFixed(2)} Hz`}</p>
                      </div>

                      <p className="hint sensorCompactLine">
                        beta / gamma: {rawOrientation.x.toFixed(1)} / {rawOrientation.y.toFixed(1)} ・ acc x / y:{' '}
                        {rawAcceleration.x?.toFixed(2) ?? '-'} / {rawAcceleration.y?.toFixed(2) ?? '-'}
                      </p>
                    </div>
                  </div>
                  <div className="row sensorCheckActions">
                    <button className="secondary" onClick={goHome}>
                      戻る
                    </button>
                    <button className="primary" onClick={goToPrepare} disabled={!hasOrientationEvent || !isHeightValid}>
                      トレーニングへ
                    </button>
                  </div>
                  {!isHeightValid && <p className="error">身長を設定してください（{HEIGHT_MIN_CM}〜{HEIGHT_MAX_CM} cm）。</p>}
                </>
              )}

              {screen === 'prepare' && (
                <>
                  <h2>準備確認</h2>
                  <ul>
                    <li>スマホを横向きに両手で持ち、画面を天井向きにする</li>
                    <li>肩関節90°屈曲（肩の高さ）で前に伸ばす</li>
                    <li>肘を伸ばし、上肢はできるだけ動かさない</li>
                  </ul>

                  <button className="primary" onClick={calibrate}>
                    この姿勢で校正
                  </button>
                </>
              )}

              {screen === 'direction_calibration' && (
                <>
                  <h2>方向校正</h2>
                  <p className="hint">
                    ゼロ校正後に、表示方向だけを端末ごとに合わせます（センサー処理の核は変更しません）。
                  </p>
                  {directionCalibStep === 'left' && (
                    <>
                      <p className="hint">1/2: 端末を「左に少し」傾けて、記録を押してください。</p>
                      <button className="primary" onClick={captureDirectionSample}>
                        左傾きの記録
                      </button>
                    </>
                  )}
                  {directionCalibStep === 'forward' && (
                    <>
                      <p className="hint">2/2: 次に「前に少し」傾けて、記録を押してください。</p>
                      <button className="primary" onClick={captureDirectionSample}>
                        前傾きの記録
                      </button>
                    </>
                  )}
                  {directionCalibStep === 'confirm' && (
                    <div className="circleScreenLayout">
                      <header className="circleTextBand circleTextBandTop">
                        <p className="hint">左で左、前で上に動くか確認</p>
                      </header>

                      <div className="circleCenterLayer">
                        <div ref={targetAreaRef} className="targetArea" aria-label="direction check preview">
                          <div className="targetCircle" />
                          <div
                            className="dot"
                            style={{
                              left: '50%',
                              top: '50%',
                              transform: `translate(-50%, -50%) translate(${(position.x * targetRadiusPx).toFixed(2)}px, ${(position.y * targetRadiusPx).toFixed(2)}px)`,
                            }}
                          />
                        </div>
                      </div>

                      <footer className="circleTextBand circleTextBandBottom circleActionBand">
                        <button className="primary circleBandButton" onClick={startCountdown}>
                          開始
                        </button>
                        <button
                          className="secondary circleBandButton"
                          onClick={() => {
                            setDirectionCalibStep('left');
                            setDirectionCalibError('');
                            setLeftTiltSample(null);
                          }}
                        >
                          再校正
                        </button>
                      </footer>
                    </div>
                  )}
                  {directionCalibError && <p className="error">{directionCalibError}</p>}
                </>
              )}

              {screen === 'countdown' && (
                <>
                  <h2>開始まで</h2>
                  <p className="big">{countdown}</p>
                </>
              )}

              {screen === 'training' && (
                <div className="circleScreenLayout">
                  <header className="circleTextBand circleTextBandTop">
                    <h2 className="trainingTitle">{settings.leg === 'left' ? '左脚' : '右脚'}</h2>
                    <p className="timer">残り: {remainingSec} 秒</p>
                  </header>

                  <div className="circleCenterLayer">
                    <div ref={targetAreaRef} className="targetArea" aria-label="balance target area">
                      <div className="targetCircle" />
                      <div
                        className="dot"
                        style={{
                          left: '50%',
                          top: '50%',
                          transform: `translate(-50%, -50%) translate(${(position.x * targetRadiusPx).toFixed(2)}px, ${(position.y * targetRadiusPx).toFixed(2)}px)`,
                        }}
                      />
                    </div>
                  </div>

                  <footer className="circleTextBand circleTextBandBottom">
                    <button className="danger circleBandButton" onClick={() => finishSession(false)}>
                      停止
                    </button>
                  </footer>
                </div>
              )}

              {screen === 'finished' && (
                <>
                  <h2>完了しました</h2>
                  <p className="hint">お疲れさまでした。</p>
                  <p className="hint">平均揺れ指標: {meanSway.toFixed(3)}</p>
                  <div className="column">
                    <button className="primary" onClick={goToPrepare}>
                      同じ条件でもう一回
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        toggleLeg();
                        goToPrepare();
                      }}
                    >
                      反対の脚で行う
                    </button>
                    <button onClick={goHome}>ホームへ戻る</button>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
