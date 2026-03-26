export type Leg = 'left' | 'right';

export type DurationOption = 20 | 30 | 60;

export type Screen =
  | 'start'
  | 'prepare'
  | 'countdown'
  | 'training'
  | 'finished';

export type Settings = {
  leg: Leg;
  durationSec: DurationOption;
};

export type SensorPoint = {
  x: number;
  y: number;
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
