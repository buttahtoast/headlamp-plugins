import {
  applyEdit,
  BUILTIN_ORGANIZATION,
  CLUSTER_CONFIG_PATHS,
  type ClusterConfig,
  clusterConfigMessages,
  type ClusterStatus,
  emptyClusterConfig,
  emptyOverrides,
  fetchClusterConfig,
  overridesFromStored,
  type PrefKey,
  type PrefsPatch,
  type ResolvedPrefs,
  resolvePrefs,
  storedOidcFields,
  type UserOverrides,
} from './clusterConfig';
import { defaultShellPrefs } from './oidc';
import { DEFAULT_REGION } from './regions';
import type { ButtahPrefs } from './types';

const KEY = 'buttah-kubeconfig.prefs';
export const PREFS_EVENT = 'buttah-prefs';

export const defaultPrefs: ButtahPrefs = {
  organization: BUILTIN_ORGANIZATION,
  homeRegion: DEFAULT_REGION,
  shell: defaultShellPrefs,
  contextNamespace: '',
};

export type PrefsView = ResolvedPrefs & {
  clusterStatus: ClusterStatus;
  clusterMessage: string;
};

let cluster: ClusterConfig = emptyClusterConfig('absent', clusterConfigMessages().absent);
let clusterLoaded = false;
let loadPromise: Promise<ClusterConfig> | null = null;

function publish(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
  }
}

export function currentClusterConfig(): ClusterConfig {
  return cluster;
}

export function installClusterConfig(config: ClusterConfig): void {
  cluster = config;
  clusterLoaded = true;
  loadPromise = Promise.resolve(config);
  publish();
}

export function resetClusterConfigForTests(): void {
  cluster = emptyClusterConfig('absent', clusterConfigMessages().absent);
  clusterLoaded = false;
  loadPromise = null;
}

function readOverrides(): UserOverrides {
  if (typeof localStorage === 'undefined') {
    return emptyOverrides();
  }
  try {
    const rawText = localStorage.getItem(KEY);
    if (!rawText) {
      return emptyOverrides();
    }
    const raw = JSON.parse(rawText) as unknown;
    const overrides = overridesFromStored(raw);
    if (storedOidcFields(raw)) {
      writeOverrides(overrides);
    }
    return overrides;
  } catch {
    return emptyOverrides();
  }
}

function writeOverrides(overrides: UserOverrides): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const stored: UserOverrides = { shell: overrides.shell };
  if (overrides.organization) {
    stored.organization = overrides.organization;
  }
  if (overrides.homeRegion) {
    stored.homeRegion = overrides.homeRegion;
  }
  if (overrides.contextNamespace) {
    stored.contextNamespace = overrides.contextNamespace;
  }
  localStorage.setItem(KEY, JSON.stringify(stored));
}

export function readPrefsView(): PrefsView {
  const resolved = resolvePrefs(readOverrides(), clusterLoaded ? cluster : null);
  return {
    ...resolved,
    clusterStatus: clusterLoaded ? cluster.status : 'loading',
    clusterMessage: clusterLoaded ? cluster.message : clusterConfigMessages().loading,
  };
}

export function readPrefs(): ButtahPrefs {
  return readPrefsView().prefs;
}

export function fieldSource(key: PrefKey): PrefsView['source'][PrefKey] {
  return readPrefsView().source[key];
}

export function writePrefs(partial: PrefsPatch): ButtahPrefs {
  const next = applyEdit(readOverrides(), partial, clusterLoaded ? cluster : null);
  writeOverrides(next);
  publish();
  return readPrefs();
}

export function headlampPathPrefix(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const configured = (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl ?? '';
  const base = configured.trim().replace(/\/$/, '');
  if (!base) {
    return '';
  }
  return base.startsWith('/') ? base : `/${base}`;
}

/** plugins/, then static-plugins/, then user-plugins/, each under the Headlamp base URL. */
export function clusterConfigRequestUrls(now = Date.now()): string[] {
  const stamp = `?t=${now}`;
  if (typeof window === 'undefined') {
    return CLUSTER_CONFIG_PATHS.map(path => `http://127.0.0.1/${path}${stamp}`);
  }
  const prefix = headlampPathPrefix();
  return CLUSTER_CONFIG_PATHS.map(path => `${window.location.origin}${prefix}/${path}${stamp}`);
}

export function ensureClusterConfig(): Promise<ClusterConfig> {
  if (loadPromise) {
    return loadPromise;
  }
  if (typeof fetch !== 'function' || typeof window === 'undefined') {
    clusterLoaded = true;
    loadPromise = Promise.resolve(cluster);
    return loadPromise;
  }
  loadPromise = fetchClusterConfig(fetch, clusterConfigRequestUrls())
    .then(config => {
      cluster = config;
      clusterLoaded = true;
      publish();
      return config;
    })
    .catch(error => {
      const detail = error instanceof Error ? error.message : 'The request failed.';
      cluster = emptyClusterConfig('invalid', clusterConfigMessages().invalid(detail));
      clusterLoaded = true;
      publish();
      return cluster;
    });
  return loadPromise;
}
