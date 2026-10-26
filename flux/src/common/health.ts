export type HealthState =
  | 'ready'
  | 'failed'
  | 'reconciling'
  | 'suspended'
  | 'configured'
  | 'unknown';
export type ResourceData = {
  apiVersion?: string;
  kind?: string;
  metadata?: Record<string, any>;
  spec?: Record<string, any>;
  status?: Record<string, any>;
  [key: string]: any;
};
export const jsonData = (resource: ResourceData): ResourceData =>
  resource?.jsonData || resource || {};
export const STATE_LABELS: Record<HealthState, string> = {
  ready: 'Ready',
  failed: 'Failed',
  reconciling: 'Reconciling',
  suspended: 'Suspended',
  configured: 'Configured',
  unknown: 'Unknown',
};
export const STATE_COLORS: Record<HealthState, string> = {
  ready: '#4caf50',
  failed: '#f44336',
  reconciling: '#2196f3',
  suspended: '#ff9800',
  configured: '#78909c',
  unknown: '#9e9e9e',
};

export function fluxState(resource: ResourceData): HealthState {
  const item = jsonData(resource);
  if (item.spec?.suspend) return 'suspended';
  const conditions = item.status?.conditions || [];
  const ready = conditions.find((c: any) => c.type === 'Ready');
  const observed = ready?.observedGeneration ?? item.status?.observedGeneration;
  if (
    observed !== undefined &&
    item.metadata?.generation !== undefined &&
    observed < item.metadata.generation
  )
    return 'reconciling';
  if (conditions.some((c: any) => c.type === 'Stalled' && c.status === 'True')) return 'failed';
  if (ready?.status === 'False')
    return ready.reason === 'DependencyNotReady' ? 'reconciling' : 'failed';
  if (conditions.some((c: any) => c.type === 'Reconciling' && c.status === 'True'))
    return 'reconciling';
  if (ready?.status === 'True') return 'ready';
  if (ready?.status === 'Unknown') return 'reconciling';
  if (['Alert', 'Provider'].includes(item.kind || '')) return 'configured';
  return 'unknown';
}

export function summarize(resources: ResourceData[]) {
  const counts: Record<HealthState, number> = {
    ready: 0,
    failed: 0,
    reconciling: 0,
    suspended: 0,
    unknown: 0,
    configured: 0,
  };
  const namespaces = new Set<string>();
  let inventory = 0;
  for (const resource of resources) {
    const value = jsonData(resource);
    counts[fluxState(value)]++;
    if (value.metadata?.namespace) namespaces.add(value.metadata.namespace);
    inventory += value.status?.inventory?.entries?.length || 0;
  }
  return { ...counts, total: resources.length, namespaces: namespaces.size, inventory };
}

export function conditionMessage(resource: ResourceData) {
  const item = jsonData(resource);
  return (
    item.status?.conditions?.find((c: any) => c.type === 'Ready')?.message ||
    item.status?.conditions?.find((c: any) => c.type === 'Stalled' && c.status === 'True')
      ?.message ||
    ''
  );
}

export function controllerReady(resource: ResourceData) {
  const item = jsonData(resource);
  return (
    (item.status?.readyReplicas ?? 0) >= (item.spec?.replicas ?? 1) &&
    (item.status?.observedGeneration ?? 0) >= (item.metadata?.generation ?? 0)
  );
}
