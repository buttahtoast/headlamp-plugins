import { useEffect, useState } from 'react';
import type { PrefsPatch } from './clusterConfig';
import {
  ensureClusterConfig,
  PREFS_EVENT,
  type PrefsView,
  readPrefsView,
  writePrefs,
} from './prefs';
import type { ButtahPrefs } from './types';

export function useButtahPrefs(): [ButtahPrefs, (partial: PrefsPatch) => void, PrefsView] {
  const [view, setView] = useState<PrefsView>(readPrefsView);

  useEffect(() => {
    const sync = () => setView(readPrefsView());
    window.addEventListener(PREFS_EVENT, sync);
    window.addEventListener('storage', sync);
    void ensureClusterConfig().then(sync);
    return () => {
      window.removeEventListener(PREFS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = (partial: Partial<ButtahPrefs>) => {
    writePrefs(partial);
    setView(readPrefsView());
  };

  return [view.prefs, update, view];
}
