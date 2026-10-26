export const API_ROOT = '/apis/velero.io/v1';

export interface Manifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    uid?: string;
    resourceVersion?: string;
    creationTimestamp?: string;
    [key: string]: any;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
  [key: string]: any;
}

export interface ArchivedObject {
  id: string;
  resource: string;
  path: string;
  manifest: Manifest;
}

export const collections = [
  'backups',
  'schedules',
  'restores',
  'backupstoragelocations',
  'volumesnapshotlocations',
  'podvolumebackups',
  'podvolumerestores',
  'datauploads',
  'datadownloads',
  'backuprepositories',
] as const;
export type Collection = (typeof collections)[number];
export type Data = Record<Collection, Manifest[]>;

export function resourcePath(namespace: string, resource: string, name?: string) {
  if (!namespace.trim()) throw new Error('A Velero namespace is required.');
  const root = ['datauploads', 'datadownloads'].includes(resource)
    ? '/apis/velero.io/v2alpha1'
    : API_ROOT;
  return `${root}/namespaces/${encodeURIComponent(namespace)}/${resource}${
    name ? `/${encodeURIComponent(name)}` : ''
  }`;
}

export function uniqueName(prefix: string) {
  return `${prefix.slice(0, 38).replace(/-+$/, '')}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function buildBackup(
  namespace: string,
  name: string,
  template: Record<string, any>,
  schedule?: Manifest
): Manifest {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) || name.length > 63) {
    throw new Error(
      'Use a DNS label for the name (lowercase letters, digits, hyphens; at most 63 characters).'
    );
  }
  return {
    apiVersion: 'velero.io/v1',
    kind: 'Backup',
    metadata: {
      name,
      namespace,
      ...(schedule ? { labels: { 'velero.io/schedule-name': schedule.metadata.name } } : {}),
    },
    spec: JSON.parse(JSON.stringify(template)),
  };
}

export function splitList(value: string) {
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function buildRestore(
  backup: Manifest,
  name: string,
  namespaces: string,
  resources: string,
  targetNamespace: string,
  restorePVs: boolean
): Manifest {
  buildBackup(backup.metadata.namespace!, name, {});
  const includedNamespaces = splitList(namespaces);
  if (targetNamespace && (includedNamespaces.length !== 1 || includedNamespaces[0] === '*')) {
    throw new Error('Namespace mapping requires exactly one source namespace.');
  }
  return {
    apiVersion: 'velero.io/v1',
    kind: 'Restore',
    metadata: { name, namespace: backup.metadata.namespace },
    spec: {
      backupName: backup.metadata.name,
      includedNamespaces: includedNamespaces.length ? includedNamespaces : ['*'],
      ...(splitList(resources).length ? { includedResources: splitList(resources) } : {}),
      ...(targetNamespace
        ? { namespaceMapping: { [includedNamespaces[0]]: targetNamespace } }
        : {}),
      existingResourcePolicy: 'none',
      restorePVs,
    },
  };
}

const volatileMetadata = [
  'uid',
  'resourceVersion',
  'generation',
  'creationTimestamp',
  'deletionTimestamp',
  'deletionGracePeriodSeconds',
  'managedFields',
  'selfLink',
];

export function normalize(manifest: Manifest): Manifest {
  const value: Manifest = JSON.parse(JSON.stringify(manifest));
  delete value.status;
  for (const key of volatileMetadata) delete value.metadata[key];
  if (value.metadata.annotations) {
    delete value.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
    if (!Object.keys(value.metadata.annotations).length) delete value.metadata.annotations;
  }
  for (const label of ['velero.io/backup-name', 'velero.io/restore-name']) {
    if (value.metadata.labels) delete value.metadata.labels[label];
  }
  if (value.metadata.labels && !Object.keys(value.metadata.labels).length)
    delete value.metadata.labels;
  return value;
}

export function recoveryManifest(manifest: Manifest, namespace?: string): Manifest {
  if (
    [
      'Pod',
      'PersistentVolume',
      'PersistentVolumeClaim',
      'VolumeSnapshot',
      'VolumeSnapshotContent',
    ].includes(manifest.kind)
  ) {
    throw new Error(
      'Use a Velero restore for pods and volume resources so Velero can perform the required recovery steps.'
    );
  }
  const value = normalize(manifest);
  delete value.metadata.ownerReferences;
  delete value.metadata.finalizers;
  delete value.metadata.generateName;
  if (value.metadata.namespace && namespace) value.metadata.namespace = namespace;
  // These values belong to the old cluster and must be allocated by Kubernetes.
  if (value.kind === 'Service' && value.spec) {
    if (value.spec.clusterIP !== 'None') {
      delete value.spec.clusterIP;
      delete value.spec.clusterIPs;
    }
    delete value.spec.healthCheckNodePort;
    value.spec.ports?.forEach((port: Record<string, any>) => delete port.nodePort);
  }
  return value;
}

export interface Difference {
  path: string;
  before: any;
  after: any;
}

export function diffObjects(before: unknown, after: unknown, limit = 1000): Difference[] {
  const changes: Difference[] = [];
  function walk(a: any, b: any, path: string) {
    if (changes.length >= limit || a === b) return;
    if (
      a &&
      b &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        walk(a[key], b[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      }
    } else changes.push({ path: path || '/', before: a, after: b });
  }
  walk(before, after, '');
  return changes;
}

export function objectId(value: Manifest) {
  const group = value.apiVersion.includes('/') ? value.apiVersion.split('/')[0] : '';
  return `${group}/${value.kind}/${value.metadata.namespace || ''}/${value.metadata.name}`;
}

export function phaseColor(phase?: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
  if (['Completed', 'Available', 'Enabled', 'Ready'].includes(phase || '')) return 'success';
  if (/Fail|Unavailable|Error/.test(phase || '')) return 'error';
  if (/Partial|Paused|Deleting/.test(phase || '')) return 'warning';
  if (/Progress|New|Waiting|Uploading|Downloading/.test(phase || '')) return 'info';
  return 'default';
}

export function errorMessage(error: unknown): string {
  return (error as any)?.message || String(error);
}
