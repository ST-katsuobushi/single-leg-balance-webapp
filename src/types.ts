export type Leg = 'left' | 'right';

export type DurationOption = 20 | 30 | 60;

export type Screen =
  | 'start'
  | 'sensor_check'
  | 'prepare'
  | 'direction_calibration'
  | 'countdown'
  | 'training'
  | 'finished';

export type DisplayTransform = {
  swapXY: boolean;
  invertX: boolean;
  invertY: boolean;
};

export type Settings = {
  leg: Leg;
  durationSec: DurationOption;
  displayTransform: DisplayTransform;
  heightMeters: number | null;
};

export type SensorPoint = {
  x: number;
  y: number;
};

export type AccelerationSample = {
  x: number | null;
  y: number | null;
  z: number | null;
};

export type SessionLog = {
  session_id: string;
  date: string;
  leg: Leg;
  target_duration_sec: number;
  actual_duration_sec: number;
  completed: boolean;
  calibration_done: boolean;
  mean_sway_index: number;
  sd_sway_index: number;
  max_sway_index: number;
  time_in_target_ratio: number;
};
