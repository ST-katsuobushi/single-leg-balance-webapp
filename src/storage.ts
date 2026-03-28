import type { SessionLog, Settings } from './types';

const SETTINGS_KEY = 'balance_app_settings_v1';
const LOG_KEY = 'balance_app_logs_v1';

export const defaultSettings: Settings = {
  leg: 'left',
  durationSec: 30,
  displayTransform: {
    swapXY: false,
    invertX: false,
    invertY: false,
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<Settings>;

    const parsedTransform = parsed.displayTransform;
    const hasValidTransform =
      !!parsedTransform &&
      typeof parsedTransform === 'object' &&
      typeof parsedTransform.swapXY === 'boolean' &&
      typeof parsedTransform.invertX === 'boolean' &&
      typeof parsedTransform.invertY === 'boolean';

    if ((parsed.leg === 'left' || parsed.leg === 'right') &&
      (parsed.durationSec === 20 || parsed.durationSec === 30 || parsed.durationSec === 60)) {
      return {
        leg: parsed.leg,
        durationSec: parsed.durationSec,
        displayTransform: hasValidTransform ? parsedTransform : defaultSettings.displayTransform,
      };
    }

    return defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function appendSessionLog(log: SessionLog) {
  const logs = loadLogs();
  logs.push(log);
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
}

export function loadLogs(): SessionLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as SessionLog[];
    }
    return [];
  } catch {
    return [];
  }
}
