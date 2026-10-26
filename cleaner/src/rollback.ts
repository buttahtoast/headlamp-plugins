import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { allowed } from './api';
import { API_ROOT, canRollback, ReportSpec, ResourceInfo } from './model';
import { decodeFullResource } from './snapshot';

export interface SavedResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    resourceVersion?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ReportSnapshot {
  metadata: { uid: string; resourceVersion: string };
  spec: ReportSpec;
}

export interface RollbackPlan {
  cluster: string;
  reportName: string;
  reportUID: string;
  reportVersion: string;
  collection: string;
  path: string;
  operation: 'create' | 'update';
  resource: SavedResource;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameResource(a: ResourceInfo, b: ResourceInfo) {
  return (
    a.resource?.apiVersion === b.resource?.apiVersion &&
    a.resource?.kind === b.resource?.kind &&
    a.resource?.name === b.resource?.name &&
    (a.resource?.namespace || '') === (b.resource?.namespace || '') &&
    (a.resource?.uid || '') === (b.resource?.uid || '')
  );
}

export function decodeSnapshot(info: ResourceInfo): SavedResource {
  const value = decodeFullResource(info.fullResource || '');
  if (
    !isObject(value) ||
    !isObject(value.metadata) ||
    typeof value.apiVersion !== 'string' ||
    !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/)?[a-z0-9]+$/.test(value.apiVersion) ||
    typeof value.kind !== 'string' ||
    !value.kind ||
    typeof value.metadata.name !== 'string' ||
    !value.metadata.name ||
    ['.', '..'].includes(value.metadata.name) ||
    /[/%]/.test(value.metadata.name) ||
    (value.metadata.namespace !== undefined &&
      (typeof value.metadata.namespace !== 'string' ||
        !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value.metadata.namespace) ||
        value.metadata.namespace.length > 63))
  ) {
    throw new Error('The captured resource needs a valid apiVersion, kind, and metadata.name.');
  }
  const obj = value as SavedResource;
  const ref = info.resource;
  if (
    !ref ||
    obj.apiVersion !== ref.apiVersion ||
    obj.kind !== ref.kind ||
    obj.metadata.name !== ref.name ||
    (obj.metadata.namespace || '') !== (ref.namespace || '') ||
    (obj.metadata.uid && ref.uid && obj.metadata.uid !== ref.uid)
  ) {
    throw new Error('The captured object does not match the resource identified in the report.');
  }
  return obj;
}

export function resourceToRestore(info: ResourceInfo): SavedResource {
  const obj = decodeSnapshot(info);
  delete obj.status;
  for (const field of [
    'uid',
    'resourceVersion',
    'generation',
    'creationTimestamp',
    'managedFields',
    'deletionTimestamp',
    'deletionGracePeriodSeconds',
    'selfLink',
    'generateName',
  ]) {
    delete obj.metadata[field];
  }
  if (isObject(obj.metadata.annotations)) {
    delete obj.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
  }
  return obj;
}

async function getLive(cluster: string, path: string): Promise<SavedResource | null> {
  try {
    return await request(path, { cluster });
  } catch (error) {
    if (isObject(error) && error.status === 404) return null;
    throw error;
  }
}

export async function prepareRollback(
  cluster: string,
  reportName: string,
  selected: ResourceInfo
): Promise<RollbackPlan> {
  const report: ReportSnapshot = await request(
    `${API_ROOT}/reports/${encodeURIComponent(reportName)}`,
    { cluster }
  );
  const info = report.spec.resourceInfo?.find(item => sameResource(item, selected));
  if (
    !canRollback(report.spec) ||
    !info?.fullResource ||
    info.fullResource !== selected.fullResource
  ) {
    throw new Error(
      'The report snapshot changed or is unavailable. Refresh the report and try again.'
    );
  }
  if (!report.metadata.uid || !report.metadata.resourceVersion) {
    throw new Error('The report has no identity or resource version. Refresh and try again.');
  }
  const captured = decodeSnapshot(info);
  const resource = resourceToRestore(info);
  const parts = resource.apiVersion.split('/');
  const group = parts.length === 2 ? parts[0] : '';
  const root = group ? `/apis/${resource.apiVersion}` : `/api/${resource.apiVersion}`;
  const discovery = await request(root, { cluster });
  const endpoint = discovery.resources?.find(
    (entry: { kind: string; name: string }) =>
      entry.kind === resource.kind && /^[a-z0-9-]+$/.test(entry.name)
  );
  if (!endpoint || typeof endpoint.namespaced !== 'boolean') {
    throw new Error(
      `No Kubernetes API endpoint was found for ${resource.apiVersion} ${resource.kind}.`
    );
  }
  if (endpoint.namespaced !== !!resource.metadata.namespace) {
    throw new Error('The saved resource namespace does not match the Kubernetes API scope.');
  }
  const collection = `${root}${
    endpoint.namespaced ? `/namespaces/${encodeURIComponent(resource.metadata.namespace!)}` : ''
  }/${endpoint.name}`;
  const path = `${collection}/${encodeURIComponent(resource.metadata.name)}`;
  const live = await getLive(cluster, path);
  const operation = live ? 'update' : 'create';
  if (live) {
    const capturedUID = info.resource?.uid || captured.metadata.uid;
    if (capturedUID && live.metadata.uid !== capturedUID) {
      throw new Error(
        'A different resource now exists with this name. It will not be overwritten.'
      );
    }
    if (!live.metadata.uid || !live.metadata.resourceVersion || live.metadata.deletionTimestamp) {
      throw new Error('The live resource is terminating or has no version. It cannot be restored.');
    }
    resource.metadata.uid = live.metadata.uid;
    resource.metadata.resourceVersion = live.metadata.resourceVersion;
    // Never replay old status. Preserve current status for CRDs without a status subresource.
    if (live.status !== undefined) resource.status = live.status;
  }
  if (
    !(await allowed(
      cluster,
      endpoint.name,
      operation,
      resource.metadata.namespace,
      live ? resource.metadata.name : undefined,
      group
    ))
  ) {
    throw new Error(
      `Your account cannot ${operation} ${endpoint.name} in ${
        resource.metadata.namespace || 'cluster scope'
      }.`
    );
  }
  return {
    cluster,
    reportName,
    reportUID: report.metadata.uid,
    reportVersion: report.metadata.resourceVersion,
    collection,
    path,
    operation,
    resource,
  };
}

export async function applyRollback(plan: RollbackPlan) {
  const report: ReportSnapshot = await request(
    `${API_ROOT}/reports/${encodeURIComponent(plan.reportName)}`,
    { cluster: plan.cluster }
  );
  if (
    report.metadata.uid !== plan.reportUID ||
    report.metadata.resourceVersion !== plan.reportVersion
  ) {
    throw new Error(
      'Report changed since confirmation. Review the latest snapshot before restoring.'
    );
  }
  if (plan.operation === 'update') {
    const live = await getLive(plan.cluster, plan.path);
    if (
      !live ||
      live.metadata.uid !== plan.resource.metadata.uid ||
      live.metadata.resourceVersion !== plan.resource.metadata.resourceVersion
    ) {
      throw new Error(
        'Resource changed since confirmation. Review its current state before restoring.'
      );
    }
  }
  // POST never falls back to overwriting an object created after the preview.
  // PUT carries the version reviewed by the user, so concurrent writes conflict.
  return request(plan.operation === 'create' ? plan.collection : plan.path, {
    cluster: plan.cluster,
    method: plan.operation === 'create' ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan.resource),
  });
}
