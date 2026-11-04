/**
 * Cluster-wide plugin settings.
 *
 * Headlamp v0.46 has no API that publishes plugin settings. It serves three
 * static directories, and only those:
 *   /plugins/        from -plugins-dir
 *   /static-plugins/ from HEADLAMP_STATIC_PLUGINS_DIR
 *   /user-plugins/   from the user plugins directory
 * A ConfigMap on disk is invisible until it is mounted into one of those
 * directories. This module tries buttah-shell-config/config.json on each URL,
 * under window.headlampBaseUrl. The file holds no secrets.
 *
 * When every URL is a 404, there is no cluster config. This plugin does not
 * embed an identity provider, image, or kubeconfig server. A file that is
 * present but invalid is not replaced by another config.
 *
 * The identity provider fields, kubeconfig.server, kubeconfig.clusterName, and
 * kubeconfig.certificateAuthorityData always come from the chosen config. A
 * browser cannot override them. kubeconfig.contextNamespace is chosen in the
 * browser. A ConfigMap may suggest one. For every other field, a locked value
 * wins, then a value saved in this browser, then an unlocked config value,
 * then the code fallback.
 */
import {
  assertClientId,
  assertHttpUrl,
  defaultShellPrefs,
  normalizeScopes,
  normalizeShellPrefs,
} from './oidc';
import { DEFAULT_REGION, REGIONS } from './regions';
import type { ButtahPrefs, ShellPrefs } from './types';

export const BUILTIN_ORGANIZATION = '';
const CONFIG_FILE = 'buttah-shell-config/config.json';

/** Tried in order. Headlamp serves each prefix from a different directory. */
export const CLUSTER_CONFIG_PATHS = [
  `plugins/${CONFIG_FILE}`,
  `static-plugins/${CONFIG_FILE}`,
  `user-plugins/${CONFIG_FILE}`,
] as const;

export const CLUSTER_CONFIG_PATH = CLUSTER_CONFIG_PATHS[0];

export const SHELL_FIELDS = [
  'issuerUrl',
  'clientId',
  'scopes',
  'authorizationEndpoint',
  'tokenEndpoint',
  'image',
  'namespace',
  'idpCaPem',
] as const;

export type ShellField = (typeof SHELL_FIELDS)[number];

/** These shell fields are never stored or edited in the browser. */
export const OIDC_SHELL_FIELDS = [
  'issuerUrl',
  'clientId',
  'scopes',
  'authorizationEndpoint',
  'tokenEndpoint',
  'idpCaPem',
] as const;

export type OidcShellField = (typeof OIDC_SHELL_FIELDS)[number];

export const KUBECONFIG_FIELDS = [
  'server',
  'certificateAuthorityData',
  'clusterName',
  'contextNamespace',
] as const;

export type KubeconfigField = (typeof KUBECONFIG_FIELDS)[number];
export type KubeconfigSettings = Partial<Record<KubeconfigField, string>>;
export type PrefKey =
  | 'organization'
  | 'homeRegion'
  | `shell.${ShellField}`
  | `kubeconfig.${KubeconfigField}`;

export const PREF_KEYS: PrefKey[] = [
  'organization',
  'homeRegion',
  ...SHELL_FIELDS.map(field => `shell.${field}` as PrefKey),
  ...KUBECONFIG_FIELDS.map(field => `kubeconfig.${field}` as PrefKey),
];

export type FieldSource = 'builtin' | 'cluster' | 'user' | 'locked' | 'admin';

export function isOidcShellField(field: string): field is OidcShellField {
  return (OIDC_SHELL_FIELDS as readonly string[]).includes(field);
}

export type ClusterStatus = 'loading' | 'absent' | 'ok' | 'invalid';

/** file: a served config.json. builtin: the copy embedded in the bundle. */
export type ClusterOrigin = 'file' | 'builtin' | 'none';

export type ClusterValues = {
  organization?: string;
  homeRegion?: string;
  shell: Partial<ShellPrefs>;
  kubeconfig: KubeconfigSettings;
};

export type ClusterConfig = {
  status: Exclude<ClusterStatus, 'loading'>;
  message: string;
  values: ClusterValues;
  locked: PrefKey[];
  origin: ClusterOrigin;
  /** URL the file was read from, without the cache-busting query. Empty for the built-in default. */
  url: string;
};

export type UserOverrides = {
  organization?: string;
  homeRegion?: string;
  shell: Partial<ShellPrefs>;
  contextNamespace?: string;
};

/** A Kubernetes namespace name. Empty is allowed at the call site. */
export function isDnsLabel(value: string): boolean {
  return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

export type ResolvedPrefs = {
  prefs: ButtahPrefs;
  source: Record<PrefKey, FieldSource>;
};

const REGION_IDS = new Set(REGIONS.map(region => region.id));

export function clusterConfigMessages(url = `/${CLUSTER_CONFIG_PATH}`) {
  return {
    loading: 'Loading config.',
    absent: 'No config file.',
    invalid: (detail: string) => (detail ? `Config file: ${detail}` : 'Config file is invalid.'),
    ready: `Config ${url}`,
    empty: 'Config file is empty.',
  };
}

export function emptyClusterConfig(
  status: ClusterConfig['status'],
  message: string
): ClusterConfig {
  return {
    status,
    message,
    values: { shell: {}, kubeconfig: {} },
    locked: [],
    origin: 'none',
    url: '',
  };
}

/** Drop the cache-busting query so the settings page shows the URL Headlamp served. */
export function clusterConfigDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://127.0.0.1');
    parsed.searchParams.delete('t');
    parsed.search = parsed.searchParams.toString() ? `?${parsed.searchParams.toString()}` : '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url
      .replace(/([?&])t=\d+(&|$)/, (_match, sep: string, tail: string) => (tail ? sep : ''))
      .replace(/[?&]$/, '');
  }
}

export function emptyOverrides(): UserOverrides {
  return { shell: {} };
}

function fail(detail: string): never {
  throw new Error(detail);
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    fail(`${label} must be a string.`);
  }
  return value;
}

function shellFieldValue(field: ShellField, value: string): string {
  if (field === 'issuerUrl' || field === 'authorizationEndpoint' || field === 'tokenEndpoint') {
    return value.trim() ? assertHttpUrl(value.trim(), field) : '';
  }
  if (field === 'clientId') {
    return value.trim() ? assertClientId(value) : '';
  }
  if (field === 'scopes') {
    return value.trim() ? normalizeScopes(value) : '';
  }
  if (field === 'namespace') {
    const name = value.trim();
    if (name && !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
      fail('shell.namespace must be a DNS label.');
    }
    return name;
  }
  if (field === 'image') {
    const image = value.trim();
    if (image && /\s/.test(image)) {
      fail('shell.image must not contain spaces.');
    }
    return image;
  }
  const pem = value.replace(/\r\n/g, '\n').trim();
  if (pem && !pem.includes('-----BEGIN CERTIFICATE-----')) {
    fail('shell.idpCaPem must be a PEM certificate.');
  }
  return pem ? `${pem}\n` : '';
}

function valueFor(values: ClusterValues, key: PrefKey): string {
  if (key === 'organization') {
    return values.organization ?? '';
  }
  if (key === 'homeRegion') {
    return values.homeRegion ?? '';
  }
  if (key.startsWith('kubeconfig.')) {
    const field = key.slice('kubeconfig.'.length) as KubeconfigField;
    return values.kubeconfig[field] ?? '';
  }
  const field = key.slice('shell.'.length) as ShellField;
  return values.shell[field] ?? '';
}

function kubeconfigFieldValue(field: KubeconfigField, value: string): string {
  if (field === 'server') {
    return value.trim() ? assertHttpUrl(value.trim(), 'kubeconfig.server') : '';
  }
  if (field === 'certificateAuthorityData') {
    const pem = value.replace(/\r\n/g, '\n').trim();
    if (!pem) {
      return '';
    }
    if (pem.includes('-----BEGIN CERTIFICATE-----')) {
      return `${pem}\n`;
    }
    let decoded = '';
    try {
      decoded = atob(pem.replace(/\s/g, ''));
    } catch {
      fail('kubeconfig.certificateAuthorityData must be a PEM certificate or its base64 form.');
    }
    if (!decoded.includes('-----BEGIN CERTIFICATE-----')) {
      fail('kubeconfig.certificateAuthorityData must be a PEM certificate or its base64 form.');
    }
    return pem.replace(/\s/g, '');
  }
  if (field === 'contextNamespace') {
    const name = value.trim();
    if (name && !isDnsLabel(name)) {
      fail('kubeconfig.contextNamespace must be a DNS label.');
    }
    return name;
  }
  const name = value.trim();
  if (name && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) {
    fail('kubeconfig.clusterName must be a short name.');
  }
  return name;
}

export function parseClusterConfig(text: string, url = `/${CLUSTER_CONFIG_PATH}`): ClusterConfig {
  const display = clusterConfigDisplayUrl(url);
  const messages = clusterConfigMessages(display);
  const invalid = (detail: string): ClusterConfig => ({
    ...emptyClusterConfig('invalid', messages.invalid(detail)),
    origin: 'file',
    url: display,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return invalid('The file is not JSON.');
  }
  try {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('The file must be a JSON object.');
    }
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(['organization', 'homeRegion', 'shell', 'kubeconfig', 'locked']);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        fail(`Unknown field ${key}.`);
      }
    }
    const values: ClusterValues = { shell: {}, kubeconfig: {} };
    const present = new Set<PrefKey>();
    if ('organization' in record) {
      present.add('organization');
      const organization = stringField(record.organization, 'organization').trim();
      if (!organization) {
        fail('organization must not be empty.');
      }
      values.organization = organization;
    }
    if ('homeRegion' in record) {
      present.add('homeRegion');
      const homeRegion = stringField(record.homeRegion, 'homeRegion').trim();
      if (!REGION_IDS.has(homeRegion)) {
        fail('homeRegion must be one of the region ids.');
      }
      values.homeRegion = homeRegion;
    }
    if ('shell' in record) {
      if (!record.shell || typeof record.shell !== 'object' || Array.isArray(record.shell)) {
        fail('shell must be an object.');
      }
      const shell = record.shell as Record<string, unknown>;
      for (const key of Object.keys(shell)) {
        if (!SHELL_FIELDS.includes(key as ShellField)) {
          fail(`Unknown field shell.${key}.`);
        }
      }
      for (const field of SHELL_FIELDS) {
        if (!(field in shell)) {
          continue;
        }
        present.add(`shell.${field}`);
        const next = shellFieldValue(field, stringField(shell[field], `shell.${field}`));
        if (next) {
          values.shell[field] = next;
        }
      }
    }
    if ('kubeconfig' in record) {
      if (
        !record.kubeconfig ||
        typeof record.kubeconfig !== 'object' ||
        Array.isArray(record.kubeconfig)
      ) {
        fail('kubeconfig must be an object.');
      }
      const kubeconfig = record.kubeconfig as Record<string, unknown>;
      for (const key of Object.keys(kubeconfig)) {
        if (!KUBECONFIG_FIELDS.includes(key as KubeconfigField)) {
          fail(`Unknown field kubeconfig.${key}.`);
        }
      }
      for (const field of KUBECONFIG_FIELDS) {
        if (!(field in kubeconfig)) {
          continue;
        }
        present.add(`kubeconfig.${field}`);
        const next = kubeconfigFieldValue(
          field,
          stringField(kubeconfig[field], `kubeconfig.${field}`)
        );
        if (next) {
          values.kubeconfig[field] = next;
        }
      }
    }
    const locked: PrefKey[] = [];
    if ('locked' in record) {
      if (!Array.isArray(record.locked)) {
        fail('locked must be a list of field names.');
      }
      for (const entry of record.locked) {
        if (typeof entry !== 'string' || !PREF_KEYS.includes(entry as PrefKey)) {
          fail(`Unknown locked field ${String(entry)}.`);
        }
        const key = entry as PrefKey;
        if (!present.has(key)) {
          fail(`${key} is locked but has no value.`);
        }
        if (!locked.includes(key)) {
          locked.push(key);
        }
      }
    }
    const hasValue = Boolean(
      values.organization ||
        values.homeRegion ||
        Object.keys(values.shell).length ||
        Object.keys(values.kubeconfig).length
    );
    return {
      status: 'ok',
      message: hasValue ? messages.ready : messages.empty,
      values,
      locked,
      origin: 'file',
      url: display,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The file could not be read.';
    return invalid(detail);
  }
}

export function storedOidcFields(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const shell = (raw as { shell?: unknown }).shell;
  if (!shell || typeof shell !== 'object') {
    return false;
  }
  return OIDC_SHELL_FIELDS.some(field => {
    const value = (shell as Record<string, unknown>)[field];
    return typeof value === 'string' && value.trim() !== '';
  });
}

export function oidcReady(cluster: ClusterConfig | null): boolean {
  if (!cluster || cluster.status !== 'ok') {
    return false;
  }
  return Boolean(cluster.values.shell.issuerUrl?.trim() && cluster.values.shell.clientId?.trim());
}

export function overridesFromStored(raw: unknown): UserOverrides {
  const overrides = emptyOverrides();
  if (!raw || typeof raw !== 'object') {
    return overrides;
  }
  const parsed = raw as Partial<ButtahPrefs>;
  if (typeof parsed.organization === 'string') {
    const organization = parsed.organization.trim();
    if (organization && organization !== BUILTIN_ORGANIZATION) {
      overrides.organization = organization;
    }
  }
  if (
    typeof parsed.homeRegion === 'string' &&
    parsed.homeRegion &&
    parsed.homeRegion !== DEFAULT_REGION
  ) {
    overrides.homeRegion = parsed.homeRegion;
  }
  const shell = parsed.shell;
  if (!shell || typeof shell !== 'object') {
    return overrides;
  }
  for (const field of SHELL_FIELDS) {
    if (isOidcShellField(field)) {
      continue;
    }
    const value = shell[field];
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }
    overrides.shell[field] = value;
  }
  if (typeof parsed.contextNamespace === 'string' && isDnsLabel(parsed.contextNamespace.trim())) {
    overrides.contextNamespace = parsed.contextNamespace.trim();
  }
  return overrides;
}

function builtinValue(key: PrefKey): string {
  if (key === 'organization') {
    return BUILTIN_ORGANIZATION;
  }
  if (key === 'homeRegion') {
    return DEFAULT_REGION;
  }
  if (key.startsWith('kubeconfig.')) {
    return '';
  }
  const field = key.slice('shell.'.length) as ShellField;
  return defaultShellPrefs[field];
}

export function resolvePrefs(
  overrides: UserOverrides,
  cluster: ClusterConfig | null
): ResolvedPrefs {
  const active = cluster && cluster.status === 'ok' ? cluster : emptyClusterConfig('absent', '');
  const locked = new Set(active.locked);
  const source = {} as Record<PrefKey, FieldSource>;
  const shell: Partial<ShellPrefs> = {};
  let organization = BUILTIN_ORGANIZATION;
  let homeRegion = DEFAULT_REGION;
  let contextNamespace = '';

  for (const key of PREF_KEYS) {
    const clusterValue = valueFor(active.values, key).trim();
    const shellField = key.startsWith('shell.') ? (key.slice('shell.'.length) as ShellField) : null;
    const userValue =
      key === 'organization'
        ? overrides.organization ?? ''
        : key === 'homeRegion'
        ? overrides.homeRegion ?? ''
        : key === 'kubeconfig.contextNamespace'
        ? overrides.contextNamespace ?? ''
        : shellField
        ? overrides.shell[shellField] ?? ''
        : '';
    let value = builtinValue(key);
    let fieldSource: FieldSource = 'builtin';
    if (shellField && isOidcShellField(shellField)) {
      value = clusterValue
        ? valueFor(active.values, key)
        : shellField === 'scopes'
        ? builtinValue(key)
        : '';
      fieldSource = 'admin';
    } else if (
      key === 'kubeconfig.server' ||
      key === 'kubeconfig.clusterName' ||
      key === 'kubeconfig.certificateAuthorityData'
    ) {
      value = clusterValue ? valueFor(active.values, key) : '';
      fieldSource = 'admin';
    } else if (locked.has(key) && clusterValue) {
      value = key.startsWith('shell.') ? valueFor(active.values, key) : clusterValue;
      fieldSource = 'locked';
    } else if (userValue.trim()) {
      value = userValue;
      fieldSource = 'user';
    } else if (clusterValue) {
      value = key.startsWith('shell.') ? valueFor(active.values, key) : clusterValue;
      fieldSource = 'cluster';
    }
    source[key] = fieldSource;
    if (key === 'organization') {
      organization = value;
    } else if (key === 'homeRegion') {
      homeRegion = value;
    } else if (key === 'kubeconfig.contextNamespace') {
      contextNamespace = value;
    } else if (shellField) {
      shell[shellField] = value;
    }
  }

  return {
    prefs: { organization, homeRegion, shell: normalizeShellPrefs(shell), contextNamespace },
    source,
  };
}

export type PrefsPatch = {
  organization?: string;
  homeRegion?: string;
  shell?: Partial<ShellPrefs>;
  contextNamespace?: string;
};

export function applyEdit(
  overrides: UserOverrides,
  partial: PrefsPatch,
  cluster: ClusterConfig | null
): UserOverrides {
  const locked = new Set(cluster && cluster.status === 'ok' ? cluster.locked : []);
  const next: UserOverrides = {
    organization: overrides.organization,
    homeRegion: overrides.homeRegion,
    shell: { ...overrides.shell },
    contextNamespace: overrides.contextNamespace,
  };
  if (typeof partial.organization === 'string' && !locked.has('organization')) {
    const organization = partial.organization.trim();
    if (!organization || organization === BUILTIN_ORGANIZATION) {
      delete next.organization;
    } else {
      next.organization = organization;
    }
  }
  if (typeof partial.homeRegion === 'string' && !locked.has('homeRegion')) {
    const homeRegion = partial.homeRegion.trim();
    if (!homeRegion || homeRegion === DEFAULT_REGION) {
      delete next.homeRegion;
    } else {
      next.homeRegion = homeRegion;
    }
  }
  if (partial.shell) {
    for (const field of SHELL_FIELDS) {
      if (!(field in partial.shell) || isOidcShellField(field)) {
        continue;
      }
      const key = `shell.${field}` as PrefKey;
      if (locked.has(key)) {
        continue;
      }
      const value = partial.shell[field];
      if (typeof value !== 'string' || !value.trim()) {
        delete next.shell[field];
      } else {
        next.shell[field] = value;
      }
    }
  }
  if (typeof partial.contextNamespace === 'string' && !locked.has('kubeconfig.contextNamespace')) {
    const name = partial.contextNamespace.trim();
    if (!name) {
      delete next.contextNamespace;
    } else if (isDnsLabel(name)) {
      next.contextNamespace = name;
    }
  }
  return next;
}

export function fieldNote(source: FieldSource): string {
  if (source === 'admin' || source === 'locked' || source === 'cluster') {
    return 'From the config file.';
  }
  if (source === 'user') {
    return 'Saved in this browser.';
  }
  return '';
}

/**
 * Try each URL in order. A 404 moves on. Any other failure stays invalid.
 * When every URL is missing, shell and kubeconfig stay unavailable.
 */
export async function fetchClusterConfig(
  doFetch: typeof fetch,
  urls: string | readonly string[]
): Promise<ClusterConfig> {
  const list = typeof urls === 'string' ? [urls] : [...urls];
  const checked: string[] = [];
  for (const candidate of list) {
    const display = clusterConfigDisplayUrl(candidate);
    const messages = clusterConfigMessages(display);
    let response: Response;
    try {
      response = await doFetch(candidate, { cache: 'no-store' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The request failed.';
      return {
        ...emptyClusterConfig('invalid', messages.invalid(detail)),
        origin: 'file',
        url: display,
      };
    }
    if (response.status === 404) {
      checked.push(display);
      continue;
    }
    if (!response.ok) {
      return {
        ...emptyClusterConfig(
          'invalid',
          messages.invalid(`The server returned HTTP ${response.status}.`)
        ),
        origin: 'file',
        url: display,
      };
    }
    const text = await response.text();
    if (!text.trim()) {
      return {
        ...emptyClusterConfig('invalid', messages.invalid('The file is empty.')),
        origin: 'file',
        url: display,
      };
    }
    return parseClusterConfig(text, display);
  }
  return emptyClusterConfig(
    'absent',
    clusterConfigMessages(checked[checked.length - 1] ?? `/${CLUSTER_CONFIG_PATH}`).absent
  );
}
