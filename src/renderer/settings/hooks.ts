/**
 * React hooks over the settings store (Foundation 1). The frozen contract every
 * feature cluster reads/writes settings through:
 *   const [v, setV] = useSetting('sounds.volume')
 *   const sounds    = useSettings('sounds')
 *   const [v, setV] = useScopedSetting('chart.showCountdown', chartKey)  // per-chart override
 */

import { useCallback, useSyncExternalStore } from 'react';
import { getByPath } from '../../shared/settingsSchema';
import { getSnapshot, subscribeStore, setSetting } from './store';

/** Read+write a single dot-path setting. Re-renders when that value changes. */
export function useSetting<T = unknown>(path: string): [T, (v: T) => void] {
  const value = useSyncExternalStore(subscribeStore, () => getByPath(getSnapshot(), path) as T);
  const set = useCallback((v: T) => setSetting(path, v), [path]);
  return [value, set];
}

/** Read a whole settings section (e.g. 'sounds'). Re-renders when the section changes. */
export function useSettings<T = unknown>(section: string): T {
  return useSyncExternalStore(subscribeStore, () => getByPath(getSnapshot(), section) as T);
}

/**
 * Read+write a setting with a per-chart override: returns the chart-scoped value when
 * one exists, otherwise the global value. Writing targets the chart scope when a
 * `chartKey` (`${accountId}:${symbol}:${tf}`) is given, else the global value.
 */
export function useScopedSetting<T = unknown>(path: string, chartKey: string | null): [T, (v: T) => void] {
  const value = useSyncExternalStore(subscribeStore, () => {
    const snap = getSnapshot();
    const scoped = chartKey ? getByPath(snap, `perChart.${chartKey}.${path}`) : undefined;
    return (scoped !== undefined ? scoped : getByPath(snap, path)) as T;
  });
  const set = useCallback(
    (v: T) => setSetting(chartKey ? `perChart.${chartKey}.${path}` : path, v),
    [path, chartKey],
  );
  return [value, set];
}
