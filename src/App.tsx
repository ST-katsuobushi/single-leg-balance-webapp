import { useEffect, useMemo, useRef, useState } from 'react';
import { appendSessionLog, loadSettings, saveSettings } from './storage';
import { distanceFromCenter, pointFromOrientation } from './sensor';
import type { DurationOption, Leg, Screen, SensorPoint, SessionLog, Settings } from './types';

const DURATION_OPTIONS: DurationOption[] = [20, 30, 60];
const TARGET_RADIUS = 0.4;

const PORTRAIT_LOCK_MESSAGE = '画面回転ロックをONにしてください';

type DeviceOrientationEventWithPermission = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function App() {
  const [screen, setScreen] = useState<Screen>('start');
  const [settings, setSettings] = useState<Settings>(loadSettings());
  const [countdown, setCountdown] = useState(3);
  const [remainingSec, setRemainingSec] = useState<number>(settings.durationSec);
  const [position, setPosition] = useState<SensorPoint>({ x: 0, y: 0 });
  const [rawOrientation, setRawOrientation] = useState<SensorPoint>({ x: 0, y: 0 });
  const [calibration, setCalibration] = useState<SensorPoint | null>(null);
  const [permissionError, setPermissionError] = useState<string>('');
  const [isPortraitViewport, setIsPortraitViewport] = useState(() =>
    window.matchMedia('(orientation: portrait)').matches,
  );

  const startMsRef = useRef<number | null>(null);
  const swayValuesRef = useRef<number[]>([]);
  const inTargetCountRef = useRef(0);
  const totalCountRef = useRef(0);

  useEffect(() => {
    const media = window.matchMedia('(orientation: portrait)');
    const update = () => setIsPortraitViewport(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isPortraitViewport && screen !== 'start') {
      setScreen('start');
      setCalibration(null);
      setPosition({ x: 0, y: 0 });
      setPermissionError('');
    }
  }, [isPortraitViewport, screen]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const latestRaw = {
        x: event.gamma ?? 0,
        y: event.beta ?? 0,
      };
      setRawOrientation(latestRaw);

      if (!calibration) return;

      const p = pointFromOrientation(event, calibration);
      setPosition(p);

      if (screen === 'training') {
        const d = distanceFromCenter(p);
        swayValuesRef.current.push(d);
        totalCountRef.current += 1;
        if (d <= TARGET_RADIUS) {
          inTargetCountRef.current += 1;
        }
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [calibration, screen]);

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

  async function requestMotionPermissionIfNeeded() {
    const anyOrientation = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
    if (typeof anyOrientation.requestPermission === 'function') {
      const result = await anyOrientation.requestPermission();
      if (result !== 'granted') {
        throw new Error('センサー利用が許可されませんでした。');
      }
    }
  }

  async function goToPrepare() {
    if (!isPortraitViewport) {
      setPermissionError(PORTRAIT_LOCK_MESSAGE);
      return;
    }

    try {
      setPermissionError('');
      await requestMotionPermissionIfNeeded();
      setCalibration(null);
      setPosition({ x: 0, y: 0 });
      setScreen('prepare');
    } catch (error) {
      setPermissionError(error instanceof Error ? error.message : '不明なエラーが発生しました。');
    }
  }

  function calibrate() {
    setCalibration({ ...rawOrientation });
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
    setRemainingSec(settings.durationSec);
    setScreen('start');
  }

  function toggleLeg() {
    const nextLeg: Leg = settings.leg === 'left' ? 'right' : 'left';
    setSettings((prev) => ({ ...prev, leg: nextLeg }));
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
                  <p className="hint">端末を横向きで持ち、画面を顔側に向けて開始してください。</p>

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

                  {permissionError && <p className="error">{permissionError}</p>}
                  <button className="primary" onClick={goToPrepare}>
                    開始
                  </button>
                </>
              )}

              {screen === 'prepare' && (
                <>
                  <h2>準備確認</h2>
                  <ul>
                    <li>スマホを横向きに両手で持つ</li>
                    <li>肩の高さで前に伸ばす</li>
                    <li>肘を伸ばし、上肢はできるだけ動かさない</li>
                  </ul>

                  <button className="primary" onClick={calibrate}>
                    この姿勢で校正
                  </button>
                  <button className="secondary" disabled={!calibration} onClick={startCountdown}>
                    次へ
                  </button>
                </>
              )}

              {screen === 'countdown' && (
                <>
                  <h2>開始まで</h2>
                  <p className="big">{countdown}</p>
                </>
              )}

              {screen === 'training' && (
                <>
                  <h2>練習中（{settings.leg === 'left' ? '左脚' : '右脚'}）</h2>
                  <p className="timer">残り: {remainingSec} 秒</p>

                  <div className="targetArea" aria-label="balance target area">
                    <div className="targetCircle" />
                    <div
                      className="dot"
                      style={{
                        left: `${50 + position.x * 40}%`,
                        top: `${50 + position.y * 40}%`,
                      }}
                    />
                  </div>

                  <button className="danger" onClick={() => finishSession(false)}>
                    停止
                  </button>
                </>
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
