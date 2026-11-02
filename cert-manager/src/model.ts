export interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  observedGeneration?: number;
  lastTransitionTime?: string;
}

export interface Manifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    resourceVersion?: string;
    generation?: number;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { uid: string; name: string; kind: string; apiVersion?: string }[];
    [key: string]: any;
  };
  spec?: Record<string, any>;
  status?: Record<string, any> & { conditions?: Condition[] };
}

export type Item = Manifest & { cluster: string };
export const collections = {
  certificates: {
    label: 'Certificates',
    kind: 'Certificate',
    group: 'cert-manager.io',
    namespaced: true,
    icon: 'mdi:certificate-outline',
  },
  issuers: {
    label: 'Issuers',
    kind: 'Issuer',
    group: 'cert-manager.io',
    namespaced: true,
    icon: 'mdi:account-key-outline',
  },
  clusterissuers: {
    label: 'Cluster issuers',
    kind: 'ClusterIssuer',
    group: 'cert-manager.io',
    namespaced: false,
    icon: 'mdi:shield-key-outline',
  },
  certificaterequests: {
    label: 'Certificate requests',
    kind: 'CertificateRequest',
    group: 'cert-manager.io',
    namespaced: true,
    icon: 'mdi:file-sign',
  },
  orders: {
    label: 'Orders',
    kind: 'Order',
    group: 'acme.cert-manager.io',
    namespaced: true,
    icon: 'mdi:clipboard-list-outline',
  },
  challenges: {
    label: 'Challenges',
    kind: 'Challenge',
    group: 'acme.cert-manager.io',
    namespaced: true,
    icon: 'mdi:shield-check-outline',
  },
} as const;
export type Collection = keyof typeof collections;
export type Health = 'ready' | 'issuing' | 'failed' | 'pending' | 'unknown';
export type Expiry = 'expired' | 'critical' | 'warning' | 'healthy' | 'unknown';
export const DAY = 86400000;
export const healthColors = {
  ready: 'success',
  issuing: 'info',
  failed: 'error',
  pending: 'warning',
  unknown: 'default',
} as const;
export const healthLabels = {
  ready: 'Ready',
  issuing: 'Issuing',
  failed: 'Failed',
  pending: 'Pending',
  unknown: 'Unknown',
};
export const expiryColors = {
  expired: 'error',
  critical: 'error',
  warning: 'warning',
  healthy: 'success',
  unknown: 'default',
} as const;

export function timestamp(value?: string): number | undefined {
  const result = value ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : undefined;
}

export function condition(item: Manifest, type: string) {
  return item.status?.conditions?.find(value => value.type === type);
}

export function currentCondition(item: Manifest, type: string) {
  const value = condition(item, type);
  return value?.observedGeneration !== undefined &&
    value.observedGeneration < (item.metadata.generation || 0)
    ? undefined
    : value;
}

export function health(item: Manifest): Health {
  if (
    currentCondition(item, 'Denied')?.status === 'True' ||
    currentCondition(item, 'InvalidRequest')?.status === 'True'
  )
    return 'failed';
  if (['invalid', 'errored', 'expired', 'revoked', 'deactivated'].includes(item.status?.state))
    return 'failed';
  if (item.kind === 'Order' || item.kind === 'Challenge') {
    if (item.status?.state === 'valid') return 'ready';
    return item.status?.state ? 'pending' : 'unknown';
  }
  if (currentCondition(item, 'Issuing')?.status === 'True') return 'issuing';
  const ready = currentCondition(item, 'Ready');
  if (ready?.status === 'True') return 'ready';
  if (ready?.status === 'False') {
    return ['Pending', 'Issuing', 'DoesNotExist', 'RequestChanged'].includes(ready.reason || '')
      ? 'pending'
      : 'failed';
  }
  return 'unknown';
}

export function expiry(item: Manifest, warningDays = 30, now = Date.now()): Expiry {
  const until = timestamp(item.status?.notAfter);
  if (until === undefined) return 'unknown';
  const remaining = until - now;
  if (remaining <= 0) return 'expired';
  if (remaining <= 7 * DAY) return 'critical';
  if (remaining <= warningDays * DAY) return 'warning';
  return 'healthy';
}

export function expiryText(item: Manifest, now = Date.now()) {
  const until = timestamp(item.status?.notAfter);
  if (until === undefined) return 'Unknown expiry';
  const remaining = until - now;
  const absolute = Math.abs(remaining);
  const unit =
    absolute < DAY
      ? `${Math.max(1, Math.ceil(absolute / 3600000))}h`
      : `${Math.ceil(absolute / DAY)}d`;
  return remaining <= 0 ? `Expired ${unit} ago` : `Expires in ${unit}`;
}

export function renewalDue(item: Manifest, now = Date.now()) {
  const due = timestamp(item.status?.renewalTime);
  return due !== undefined && due <= now && currentCondition(item, 'Issuing')?.status !== 'True';
}

export function needsAttention(item: Manifest, warningDays = 30, now = Date.now()) {
  return (
    health(item) !== 'ready' ||
    expiry(item, warningDays, now) !== 'healthy' ||
    renewalDue(item, now)
  );
}

export function expiryOrder(a: Manifest, b: Manifest) {
  return (
    (timestamp(a.status?.notAfter) ?? -Infinity) - (timestamp(b.status?.notAfter) ?? -Infinity) ||
    a.metadata.name.localeCompare(b.metadata.name)
  );
}

export function issuerText(item: Manifest) {
  const ref = item.spec?.issuerRef;
  return ref
    ? `${ref.kind || 'Issuer'}/${ref.name}${
        ref.group && ref.group !== 'cert-manager.io' ? ` (${ref.group})` : ''
      }`
    : '—';
}

export function message(item: Manifest) {
  const values = item.status?.conditions || [];
  const value =
    values.find(c => c.type === 'Denied' && c.status === 'True') ||
    values.find(c => c.type === 'Issuing' && c.status === 'True') ||
    values.find(c => c.type === 'Ready') ||
    values[0];
  return (
    item.status?.reason ||
    value?.message ||
    value?.reason ||
    item.status?.state ||
    'No status reported'
  );
}

export function resourcePath(collection: Collection, namespace?: string, name?: string) {
  const descriptor = collections[collection];
  return `/apis/${descriptor.group}/v1${
    descriptor.namespaced && namespace ? `/namespaces/${encodeURIComponent(namespace)}` : ''
  }/${collection}${name ? `/${encodeURIComponent(name)}` : ''}`;
}

export function renewalPatch(item: Manifest, now = new Date()) {
  if (
    item.kind !== 'Certificate' ||
    !item.metadata.namespace ||
    !item.metadata.uid ||
    !item.metadata.resourceVersion
  )
    throw new Error('A live Certificate with UID and resource version is required.');
  if (condition(item, 'Issuing')?.status === 'True')
    throw new Error(
      'This certificate is already issuing. Follow the current request before renewing again.'
    );
  const conditions = (item.status?.conditions || []).filter(value => value.type !== 'Issuing');
  conditions.push({
    type: 'Issuing',
    status: 'True',
    observedGeneration: item.metadata.generation || 1,
    reason: 'ManuallyTriggered',
    message: 'Certificate re-issuance manually triggered',
    lastTransitionTime: now.toISOString(),
  });
  return [
    { op: 'test', path: '/metadata/uid', value: item.metadata.uid },
    { op: 'test', path: '/metadata/resourceVersion', value: item.metadata.resourceVersion },
    ...(item.status ? [] : [{ op: 'add', path: '/status', value: {} }]),
    { op: 'add', path: '/status/conditions', value: conditions },
  ];
}

export function renewalComplete(before: Manifest, after: Manifest) {
  const revisionChanged =
    typeof after.status?.revision === 'number' &&
    after.status.revision > (before.status?.revision || 0);
  const expiryChanged =
    !!after.status?.notAfter && after.status.notAfter !== before.status?.notAfter;
  return (
    before.metadata.uid === after.metadata.uid &&
    (revisionChanged || expiryChanged) &&
    health(after) === 'ready'
  );
}

export function descendants(root: Manifest, items: Item[]) {
  const uids = new Set([root.metadata.uid].filter(Boolean));
  const related = new Set<Item>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (
        !related.has(item) &&
        item.metadata.namespace === root.metadata.namespace &&
        item.metadata.ownerReferences?.some(ref => uids.has(ref.uid))
      ) {
        related.add(item);
        if (item.metadata.uid) uids.add(item.metadata.uid);
        changed = true;
      }
    }
  }
  return [...related];
}

export function portable(item: Manifest) {
  return {
    apiVersion: item.apiVersion,
    kind: item.kind,
    metadata: {
      name: item.metadata.name,
      ...(item.metadata.namespace ? { namespace: item.metadata.namespace } : {}),
      ...(item.metadata.labels ? { labels: item.metadata.labels } : {}),
    },
    spec: item.spec,
  };
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof (error as any)?.message === 'string'
    ? (error as any).message
    : String(error);
}
