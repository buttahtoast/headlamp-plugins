import { jsonData, ResourceData } from '../common/health';

export interface ObjectRef {
  id: string;
  name: string;
  namespace?: string;
  group: string;
  version: string;
  kind: string;
}
export interface InventoryRecord extends ObjectRef {
  object?: ResourceData;
  state: 'loading' | 'loaded' | 'missing' | 'forbidden' | 'error';
  message?: string;
  plural?: string;
}

export function referenceId(ref: Pick<ObjectRef, 'group' | 'kind' | 'namespace' | 'name'>) {
  return [ref.group, ref.kind, ref.namespace || '', ref.name].join('/');
}

export function parseInventoryEntry(entry: { id: string; v: string }): ObjectRef {
  const kindAt = entry.id.lastIndexOf('_');
  const groupAt = entry.id.lastIndexOf('_', kindAt - 1);
  const namespaceAt = entry.id.indexOf('_');
  if (namespaceAt < 0 || groupAt <= namespaceAt || kindAt <= groupAt || !entry.v)
    throw new Error(`Invalid Flux inventory entry: ${entry.id}`);
  const ref = {
    namespace: entry.id.slice(0, namespaceAt) || undefined,
    name: entry.id.slice(namespaceAt + 1, groupAt),
    group: entry.id.slice(groupAt + 1, kindAt),
    kind: entry.id.slice(kindAt + 1),
    version: entry.v,
  };
  if (!ref.name || !ref.kind) throw new Error(`Invalid Flux inventory entry: ${entry.id}`);
  return { ...ref, id: referenceId(ref) };
}

export function manifestReference(value: ResourceData, defaultNamespace?: string): ObjectRef {
  if (!value.apiVersion || !value.kind || !value.metadata?.name)
    throw new Error('Rendered Helm manifest contains an incomplete Kubernetes object.');
  const pieces = value.apiVersion.split('/');
  const ref = {
    kind: value.kind,
    name: value.metadata.name,
    namespace: value.metadata.namespace || defaultNamespace,
    group: pieces.length > 1 ? pieces[0] : '',
    version: pieces[pieces.length - 1],
  };
  return { ...ref, id: referenceId(ref) };
}

export function objectStatus(record: InventoryRecord): {
  label: string;
  color: 'success' | 'error' | 'warning' | 'info' | 'default';
} {
  if (record.state !== 'loaded')
    return {
      label: {
        loading: 'Loading',
        missing: 'Missing',
        forbidden: 'No access',
        error: 'Unavailable',
      }[record.state],
      color: record.state === 'missing' ? 'error' : record.state === 'loading' ? 'info' : 'warning',
    };
  const value = jsonData(record.object || {});
  const conditions = value.status?.conditions || [];
  const condition = conditions.find((c: any) =>
    ['Ready', 'Available', 'Healthy', 'Established'].includes(c.type)
  );
  const observed = value.status?.observedGeneration ?? condition?.observedGeneration;
  if (observed !== undefined && observed < (value.metadata?.generation ?? 0))
    return { label: 'Reconciling', color: 'info' };
  if (value.metadata?.deletionTimestamp) return { label: 'Deleting', color: 'warning' };
  if (['Deployment', 'StatefulSet'].includes(value.kind || '')) {
    const desired = value.spec?.replicas ?? 1;
    return {
      label: !desired ? 'Scaled to zero' : `${value.status?.readyReplicas || 0}/${desired} ready`,
      color: !desired
        ? 'default'
        : (value.status?.readyReplicas || 0) >= desired
        ? 'success'
        : 'warning',
    };
  }
  if (value.kind === 'DaemonSet') {
    const desired = value.status?.desiredNumberScheduled;
    return {
      label: `${value.status?.numberReady || 0}/${desired ?? '?'} ready`,
      color: desired !== undefined && value.status?.numberReady >= desired ? 'success' : 'warning',
    };
  }
  if (value.kind === 'Pod' && value.status?.phase === 'Succeeded')
    return { label: 'Completed', color: 'success' };
  if (value.kind === 'Pod' && value.status?.phase === 'Failed')
    return { label: 'Failed', color: 'error' };
  if (value.kind === 'Job') {
    if (conditions.some((c: any) => c.type === 'Complete' && c.status === 'True'))
      return { label: 'Completed', color: 'success' };
    if (conditions.some((c: any) => c.type === 'Failed' && c.status === 'True'))
      return { label: 'Failed', color: 'error' };
    return { label: 'Running', color: 'info' };
  }
  if (condition)
    return {
      label:
        condition.status === 'True'
          ? 'Ready'
          : condition.status === 'False'
          ? 'Not ready'
          : 'Unknown',
      color:
        condition.status === 'True'
          ? 'success'
          : condition.status === 'False'
          ? 'error'
          : 'default',
    };
  if (value.kind === 'PersistentVolumeClaim')
    return {
      label: value.status?.phase || 'Unknown',
      color:
        value.status?.phase === 'Bound'
          ? 'success'
          : value.status?.phase === 'Lost'
          ? 'error'
          : 'warning',
    };
  if (value.kind === 'Namespace')
    return {
      label: value.status?.phase || 'Present',
      color: value.status?.phase === 'Active' ? 'success' : 'default',
    };
  return { label: 'Present', color: 'default' };
}

export function releaseIdentity(resource: ResourceData) {
  const value = jsonData(resource);
  return {
    name:
      value.status?.history?.[0]?.name ||
      value.spec?.releaseName ||
      (value.spec?.targetNamespace
        ? `${value.spec.targetNamespace}-${value.metadata?.name}`
        : value.metadata?.name),
    namespace:
      value.status?.storageNamespace || value.spec?.storageNamespace || value.metadata?.namespace,
    targetNamespace: value.spec?.targetNamespace || value.metadata?.namespace,
  };
}

export interface DiagramNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
  width: number;
  height: number;
  style: { width: number; height: number };
  parentId?: string;
  extent?: 'parent';
}

/** Namespace containers use a shared grid; the open detail resource is already the context. */
export function buildInventoryGraph(
  owner: ResourceData,
  records: InventoryRecord[],
  compact = false
) {
  const value = jsonData(owner);
  const grouped = new Map<string, InventoryRecord[]>();
  records.forEach(record => {
    const key = record.namespace || '';
    grouped.set(key, [...(grouped.get(key) || []), record]);
  });
  const groups = [...grouped.entries()]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
    .map(([namespace, objects]) => {
      const kindCounts = new Map<string, number>();
      objects.forEach(record =>
        kindCounts.set(record.kind, (kindCounts.get(record.kind) || 0) + 1)
      );
      const targets = compact
        ? [...kindCounts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([kind, count]) => ({
              id: `kind:${namespace}:${kind}`,
              kind,
              name: kind,
              count,
              record: undefined as InventoryRecord | undefined,
            }))
        : [...objects]
            .sort(
              (a, b) =>
                a.kind.localeCompare(b.kind) ||
                a.name.localeCompare(b.name) ||
                a.group.localeCompare(b.group)
            )
            .map(record => ({
              id: `resource:${record.id}`,
              kind: record.kind,
              name: record.name,
              count: 1,
              record,
            }));
      return { namespace, objects, targets };
    });
  const columns = Math.min(3, Math.max(1, ...groups.map(group => group.targets.length)));
  const cardWidth = 280;
  const cardHeight = 88;
  const stepX = 304;
  const stepY = 112;
  const padding = 20;
  const header = 56;
  const groupWidth = padding * 2 + columns * cardWidth + (columns - 1) * (stepX - cardWidth);
  const nodes: DiagramNode[] = [];
  const edges: { id: string; source: string; target: string; animated?: boolean }[] = [];
  const addNode = (node: Omit<DiagramNode, 'style'>) =>
    nodes.push({ ...node, style: { width: node.width, height: node.height } });
  let y = 20;
  let firstContent = 0;
  let lastContent = 0;
  groups.forEach(({ namespace, objects, targets }, groupIndex) => {
    const rows = Math.ceil(targets.length / columns);
    const contentHeight = cardHeight + (rows - 1) * stepY;
    const height = header + contentHeight + padding;
    const id = `namespace:${namespace || '__cluster__'}`;
    if (!groupIndex) firstContent = y + header;
    lastContent = y + header + contentHeight;
    addNode({
      id,
      type: 'namespace',
      position: { x: 0, y },
      width: groupWidth,
      height,
      data: {
        role: 'namespace',
        kind: namespace ? 'Namespace' : 'Cluster scope',
        name: namespace || 'Cluster-scoped',
        namespace: namespace || undefined,
        count: objects.length,
        contentCenter: header + contentHeight / 2,
      },
    });
    targets.forEach((target, index) =>
      addNode({
        id: target.id,
        type: 'inventory',
        parentId: id,
        extent: 'parent',
        position: {
          x: padding + (index % columns) * stepX,
          y: header + Math.floor(index / columns) * stepY,
        },
        width: cardWidth,
        height: cardHeight,
        data: {
          role: target.record ? 'resource' : 'kind',
          kind: target.kind,
          name: target.name,
          namespace: namespace || undefined,
          record: target.record,
          count: target.count,
          subtitle: target.kind,
          status: target.record
            ? objectStatus(target.record)
            : { label: `${target.count} objects`, color: 'default' },
        },
      })
    );
    y += height + 32;
  });
  const source =
    value.spec?.sourceRef || value.spec?.chartRef || value.spec?.chart?.spec?.sourceRef;
  const context = [
    ...(source?.name
      ? [
          {
            id: 'source',
            role: 'source',
            kind: source.kind,
            name: source.name,
            namespace: source.namespace || value.metadata?.namespace,
            subtitle: 'Source',
          },
        ]
      : []),
    ...(value.spec?.dependsOn || []).map((dependency: any, index: number) => ({
      id: `dependency:${index}:${dependency.namespace || value.metadata?.namespace}/${
        dependency.name
      }`,
      role: 'dependency',
      kind: value.kind,
      name: dependency.name,
      namespace: dependency.namespace || value.metadata?.namespace,
      subtitle: 'Depends on',
    })),
  ];
  const center = groups.length ? (firstContent + lastContent) / 2 : 64;
  const contextHeight = cardHeight + Math.max(0, context.length - 1) * stepY;
  context.forEach((data, index) => {
    addNode({
      id: data.id,
      type: 'inventory',
      position: { x: -344, y: center - contextHeight / 2 + index * stepY },
      width: cardWidth,
      height: cardHeight,
      data,
    });
    groups.forEach(({ namespace }) =>
      edges.push({
        id: `${data.id}:namespace:${namespace || '__cluster__'}`,
        source: data.id,
        target: `namespace:${namespace || '__cluster__'}`,
        animated: data.role === 'source',
      })
    );
  });
  return { nodes, edges };
}
