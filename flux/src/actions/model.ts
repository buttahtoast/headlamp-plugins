import { jsonData, ResourceData } from '../common/health';

export type Operation = 'reconcile' | 'suspend' | 'resume' | 'force-apply' | 'delete' | 'edit';
export interface Capabilities {
  group: string;
  plural: string;
  cli?: string;
  reconcile?: boolean;
  suspend?: boolean;
  source?: boolean;
  force?: boolean;
  reset?: boolean;
  controller?: string;
  extension?: boolean;
}
const source = (plural: string, cli: string): Capabilities => ({
  group: 'source.toolkit.fluxcd.io',
  plural,
  cli: `source ${cli}`,
  reconcile: true,
  suspend: true,
  controller: 'source-controller',
});
const image = (plural: string, cli: string): Capabilities => ({
  group: 'image.toolkit.fluxcd.io',
  plural,
  cli: `image ${cli}`,
  reconcile: true,
  suspend: true,
  controller: cli === 'update' ? 'image-automation-controller' : 'image-reflector-controller',
});

export const CAPABILITIES: Record<string, Capabilities> = {
  Kustomization: {
    group: 'kustomize.toolkit.fluxcd.io',
    plural: 'kustomizations',
    cli: 'kustomization',
    reconcile: true,
    suspend: true,
    source: true,
    controller: 'kustomize-controller',
  },
  HelmRelease: {
    group: 'helm.toolkit.fluxcd.io',
    plural: 'helmreleases',
    cli: 'helmrelease',
    reconcile: true,
    suspend: true,
    source: true,
    force: true,
    reset: true,
    controller: 'helm-controller',
  },
  GitRepository: source('gitrepositories', 'git'),
  OCIRepository: source('ocirepositories', 'oci'),
  HelmRepository: source('helmrepositories', 'helm'),
  Bucket: source('buckets', 'bucket'),
  HelmChart: { ...source('helmcharts', 'chart'), source: true },
  ImageRepository: image('imagerepositories', 'repository'),
  ImagePolicy: image('imagepolicies', 'policy'),
  ImageUpdateAutomation: image('imageupdateautomations', 'update'),
  Alert: {
    group: 'notification.toolkit.fluxcd.io',
    plural: 'alerts',
    cli: 'alert',
    suspend: true,
    controller: 'notification-controller',
  },
  Provider: {
    group: 'notification.toolkit.fluxcd.io',
    plural: 'providers',
    cli: 'alert-provider',
    suspend: true,
    controller: 'notification-controller',
  },
  Receiver: {
    group: 'notification.toolkit.fluxcd.io',
    plural: 'receivers',
    cli: 'receiver',
    reconcile: true,
    suspend: true,
    controller: 'notification-controller',
  },
  ExternalArtifact: {
    group: 'source.toolkit.fluxcd.io',
    plural: 'externalartifacts',
    cli: 'source external',
    controller: 'source-controller',
  },
  ArtifactGenerator: {
    group: 'source.extensions.fluxcd.io',
    plural: 'artifactgenerators',
    cli: 'artifact generator',
    controller: 'source-watcher',
  },
  Canary: {
    group: 'flagger.app',
    plural: 'canaries',
    suspend: true,
    controller: 'flagger',
    extension: true,
  },
};

export interface ResourceRef {
  apiVersion: string;
  kind: string;
  namespace: string;
  name: string;
  uid?: string;
  cluster: string;
}
export interface ActionOptions {
  withSource?: boolean;
  force?: boolean;
  reset?: boolean;
  wait?: boolean;
  timeoutMs?: number;
  forceApply?: boolean;
  original?: ResourceData;
  edited?: ResourceData;
}
export interface PatchOperation {
  op: 'test' | 'add' | 'replace' | 'remove';
  path: string;
  value?: any;
}
export interface Step {
  id: string;
  ref: ResourceRef;
  snapshot: ResourceData;
  operation: Operation;
  options: ActionOptions;
  sourceSignature: string;
  token: string;
  dependencies: string[];
  mustWait: boolean;
  preview: PatchOperation[];
}
export interface ActionDefinition {
  id: string;
  label: string;
  operation?: Operation;
  icon: string;
  options?: ActionOptions;
}

export function capability(resource: ResourceData): Capabilities | undefined {
  const value = jsonData(resource);
  const candidate = CAPABILITIES[value.kind];
  return candidate && value.apiVersion?.split('/')[0] === candidate.group ? candidate : undefined;
}

export function resourceRef(resource: ResourceData, cluster: string): ResourceRef {
  const value = jsonData(resource);
  if (!capability(value) || !value.metadata?.name || !value.metadata?.namespace || !cluster)
    throw new Error('A supported Flux resource, namespace and cluster are required.');
  return {
    apiVersion: value.apiVersion,
    kind: value.kind,
    namespace: value.metadata.namespace,
    name: value.metadata.name,
    uid: value.metadata.uid,
    cluster,
  };
}

export function referenceKey(ref: ResourceRef) {
  return [ref.cluster, ref.apiVersion, ref.kind, ref.namespace, ref.name].join('/');
}
export function objectPath(ref: ResourceRef) {
  const cap = capability({ apiVersion: ref.apiVersion, kind: ref.kind });
  if (!cap) throw new Error(`Unsupported resource ${ref.kind} (${ref.apiVersion}).`);
  return `/apis/${ref.apiVersion}/namespaces/${encodeURIComponent(ref.namespace)}/${
    cap.plural
  }/${encodeURIComponent(ref.name)}`;
}

export function isStatic(resource: ResourceData) {
  const value = jsonData(resource);
  return (
    ['Alert', 'Provider', 'Canary'].includes(value.kind) ||
    (value.kind === 'HelmRepository' && value.spec?.type === 'oci')
  );
}

export function actionDefinitions(resource: ResourceData): ActionDefinition[] {
  const value = jsonData(resource);
  const cap = capability(value);
  if (!cap) return [];
  return [
    ...(cap.reconcile
      ? [
          {
            id: 'reconcile',
            label: 'Reconcile',
            operation: 'reconcile' as Operation,
            icon: 'mdi:sync',
          },
        ]
      : []),
    ...(cap.source
      ? [
          {
            id: 'reconcile-source',
            label: 'Reconcile with source',
            operation: 'reconcile' as Operation,
            icon: 'mdi:source-branch-sync',
            options: { withSource: true },
          },
        ]
      : []),
    ...(cap.reset
      ? [
          {
            id: 'reset',
            label: 'Reset failures and reconcile',
            operation: 'reconcile' as Operation,
            icon: 'mdi:counter',
            options: { reset: true },
          },
        ]
      : []),
    ...(cap.force
      ? [
          {
            id: 'force',
            label: 'Force install / upgrade',
            operation: 'reconcile' as Operation,
            icon: 'mdi:alert-decagram-outline',
            options: { force: true },
          },
        ]
      : []),
    ...(cap.suspend
      ? [
          { id: 'suspend', label: 'Suspend', operation: 'suspend' as Operation, icon: 'mdi:pause' },
          { id: 'resume', label: 'Resume', operation: 'resume' as Operation, icon: 'mdi:play' },
        ]
      : []),
    ...(value.kind === 'Kustomization'
      ? [
          {
            id: 'force-apply',
            label: value.spec?.force ? 'Disable force apply' : 'Enable force apply',
            operation: 'force-apply' as Operation,
            icon: 'mdi:file-replace-outline',
            options: { forceApply: !value.spec?.force },
          },
        ]
      : []),
    { id: 'status', label: 'Inspect status', icon: 'mdi:clipboard-pulse-outline' },
    { id: 'events', label: 'Events', icon: 'mdi:calendar-text' },
    { id: 'logs', label: 'Controller logs', icon: 'mdi:console' },
    { id: 'view', label: 'View YAML', icon: 'mdi:file-code-outline' },
    { id: 'export', label: 'Export YAML', icon: 'mdi:download' },
    { id: 'edit', label: 'Edit YAML', operation: 'edit' as Operation, icon: 'mdi:pencil' },
    { id: 'commands', label: 'CLI commands', icon: 'mdi:code-tags' },
    { id: 'delete', label: 'Delete', operation: 'delete' as Operation, icon: 'mdi:delete-outline' },
  ];
}

export function sourceReference(
  resource: ResourceData
): { kind: string; name: string; namespace: string; withSource?: boolean } | undefined {
  const value = jsonData(resource);
  const namespace = value.metadata?.namespace;
  if (value.kind === 'HelmRelease') {
    if (value.spec?.chartRef)
      return {
        ...value.spec.chartRef,
        namespace: value.spec.chartRef.namespace || namespace,
        withSource: value.spec.chartRef.kind === 'HelmChart',
      };
    if (value.spec?.chart?.spec?.sourceRef) {
      const parts = value.status?.helmChart?.split('/');
      return {
        kind: 'HelmChart',
        namespace:
          parts?.length === 2 ? parts[0] : value.spec.chart.spec.sourceRef.namespace || namespace,
        name: parts?.length === 2 ? parts[1] : `${namespace}-${value.metadata.name}`,
        withSource: true,
      };
    }
  }
  if (['Kustomization', 'HelmChart'].includes(value.kind) && value.spec?.sourceRef)
    return { ...value.spec.sourceRef, namespace: value.spec.sourceRef.namespace || namespace };
  return undefined;
}

export function sourceSignature(resource: ResourceData) {
  const value = jsonData(resource);
  return JSON.stringify([
    sourceReference(value) || null,
    value.spec?.chart?.spec?.sourceRef || null,
  ]);
}

export function exportResource(resource: ResourceData): ResourceData {
  const value = jsonData(resource);
  return JSON.parse(
    JSON.stringify({
      apiVersion: value.apiVersion,
      kind: value.kind,
      metadata: {
        name: value.metadata?.name,
        namespace: value.metadata?.namespace,
        ...(value.metadata?.labels ? { labels: value.metadata.labels } : {}),
        ...(value.metadata?.annotations ? { annotations: value.metadata.annotations } : {}),
      },
      ...(value.spec ? { spec: value.spec } : {}),
    })
  );
}

const pointer = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1');
const equal = (a: any, b: any): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    Array.isArray(a) === Array.isArray(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(key => equal(a[key], b[key])));

export function buildEditPatch(
  original: ResourceData,
  edited: ResourceData,
  current: ResourceData
): PatchOperation[] {
  for (const value of [edited, current])
    if (
      value.apiVersion !== original.apiVersion ||
      value.kind !== original.kind ||
      value.metadata?.name !== original.metadata?.name ||
      value.metadata?.namespace !== original.metadata?.namespace
    )
      throw new Error('Resource identity cannot be changed in this editor.');
  if (
    edited.status ||
    Object.keys(edited).some(key => !['apiVersion', 'kind', 'metadata', 'spec'].includes(key)) ||
    Object.keys(edited.metadata || {}).some(
      key => !['name', 'namespace', 'labels', 'annotations'].includes(key)
    )
  )
    throw new Error(
      'Edit only metadata labels/annotations and spec. Server fields and status are not editable here.'
    );
  const patch: PatchOperation[] = [];
  function walk(before: any, after: any, live: any, path: string) {
    if (equal(before, after)) return;
    if (
      before &&
      after &&
      typeof before === 'object' &&
      typeof after === 'object' &&
      !Array.isArray(before) &&
      !Array.isArray(after)
    ) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
        walk(before[key], after[key], live?.[key], `${path}/${pointer(key)}`);
      return;
    }
    if (!equal(before, live))
      throw new Error(`Resource changed at ${path}. Reload and review your edit again.`);
    if (before !== undefined) patch.push({ op: 'test', path, value: before });
    patch.push(
      after === undefined
        ? { op: 'remove', path }
        : { op: before === undefined ? 'add' : 'replace', path, value: after }
    );
  }
  walk(exportResource(original), edited, exportResource(current), '');
  return patch;
}

export function buildPatch(
  resource: ResourceData,
  operation: Operation,
  options: ActionOptions,
  token: string
): PatchOperation[] {
  const value = jsonData(resource);
  const cap = capability(value);
  if (!cap) throw new Error('This resource does not support Flux actions.');
  const patch: PatchOperation[] = [];
  if (value.metadata?.uid)
    patch.push({ op: 'test', path: '/metadata/uid', value: value.metadata.uid });
  if (value.metadata?.resourceVersion)
    patch.push({
      op: 'test',
      path: '/metadata/resourceVersion',
      value: value.metadata.resourceVersion,
    });
  if (operation === 'edit')
    return [...patch, ...buildEditPatch(options.original, options.edited, value)];
  if (operation === 'reconcile') {
    if (!cap.reconcile) throw new Error(`${value.kind} has no reconcile command in the Flux CLI.`);
    if (value.spec?.suspend)
      throw new Error(`${value.kind} ${value.metadata.name} is suspended. Resume it first.`);
    if (
      (options.force && !cap.force) ||
      (options.reset && !cap.reset) ||
      (options.withSource && !cap.source)
    )
      throw new Error('The selected reconcile options are not supported by this resource kind.');
    if (isStatic(value)) return [];
    const annotations = {
      'reconcile.fluxcd.io/requestedAt': token,
      ...(options.force ? { 'reconcile.fluxcd.io/forceAt': token } : {}),
      ...(options.reset ? { 'reconcile.fluxcd.io/resetAt': token } : {}),
    };
    if (!value.metadata.annotations)
      patch.push({ op: 'add', path: '/metadata/annotations', value: annotations });
    else
      for (const [key, annotation] of Object.entries(annotations))
        patch.push({ op: 'add', path: `/metadata/annotations/${pointer(key)}`, value: annotation });
  } else if (operation === 'suspend' || operation === 'resume') {
    if (!cap.suspend) throw new Error(`${value.kind} does not support suspension.`);
    const desired = operation === 'suspend';
    if (!!value.spec?.suspend === desired) return [];
    patch.push(
      value.spec
        ? { op: 'add', path: '/spec/suspend', value: desired }
        : { op: 'add', path: '/spec', value: { suspend: desired } }
    );
  } else if (operation === 'force-apply') {
    if (value.kind !== 'Kustomization')
      throw new Error('Persistent force apply is a Kustomization setting.');
    patch.push({ op: 'add', path: '/spec/force', value: !!options.forceApply });
  }
  return patch;
}

export function reconciliationStatus(
  resource: ResourceData,
  operation: Operation,
  token?: string
): { done: boolean; error?: string } {
  const value = jsonData(resource);
  if (value.metadata?.deletionTimestamp) return { done: true, error: 'Resource is being deleted.' };
  if (value.spec?.suspend) return { done: true, error: 'Resource is suspended.' };
  if (isStatic(value)) return { done: true };
  if (operation === 'reconcile' && value.status?.lastHandledReconcileAt !== token)
    return { done: false };
  const conditions = value.status?.conditions || [];
  const ready = conditions.find((condition: any) => condition.type === 'Ready');
  const observed = [value.status?.observedGeneration, ready?.observedGeneration];
  if (
    observed.some(
      generation => generation !== undefined && generation < (value.metadata?.generation || 0)
    )
  )
    return { done: false };
  if (
    conditions.some(
      (condition: any) => condition.type === 'Reconciling' && condition.status === 'True'
    )
  )
    return { done: false };
  const stalled = conditions.find(
    (condition: any) => condition.type === 'Stalled' && condition.status === 'True'
  );
  if (stalled || ready?.status === 'False')
    return {
      done: true,
      error: stalled?.message || ready?.message || ready?.reason || 'Reconciliation failed.',
    };
  return { done: ready?.status === 'True' };
}

export function cliCommand(
  resource: ResourceData,
  operation: string,
  options: ActionOptions = {}
): string {
  const value = jsonData(resource);
  const cap = capability(value);
  if (!cap) return '';
  const q = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const suffix = `${q(value.metadata.name)} --namespace ${q(
    value.metadata.namespace
  )} --context '<kubeconfig-context>'`;
  const flags = `${options.withSource ? ' --with-source' : ''}${options.force ? ' --force' : ''}${
    options.reset ? ' --reset' : ''
  }`;
  const kubectl = `kubectl`;
  const target = `${cap.plural}.${cap.group} ${suffix}`;
  if (operation === 'edit') return `${kubectl} edit ${target}`;
  if (operation === 'force-apply')
    return `${kubectl} patch ${target} --type merge -p '${JSON.stringify({
      spec: { force: !!options.forceApply },
    })}'`;
  if (!cap.cli && operation === 'reconcile')
    return `${kubectl} annotate ${target} reconcile.fluxcd.io/requestedAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --overwrite`;
  if (!cap.cli && ['suspend', 'resume'].includes(operation))
    return `${kubectl} patch ${target} --type merge -p '${JSON.stringify({
      spec: { suspend: operation === 'suspend' },
    })}'`;
  if (operation === 'reconcile' && cap.cli && cap.reconcile)
    return `flux reconcile ${cap.cli} ${suffix}${flags}`;
  if (
    ['suspend', 'resume', 'export', 'delete'].includes(operation) &&
    cap.cli &&
    (!['suspend', 'resume'].includes(operation) || cap.suspend) &&
    !(operation === 'delete' && ['ExternalArtifact', 'ArtifactGenerator'].includes(value.kind))
  )
    return `flux ${operation} ${cap.cli} ${suffix}`;
  return `kubectl ${operation === 'export' ? 'get' : operation} ${cap.plural}.${
    cap.group
  } ${suffix}${operation === 'export' ? ' -o yaml' : ''}`;
}
