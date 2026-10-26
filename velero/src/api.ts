import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { MAX_COMPRESSED, readBounded } from './archive';
import { Manifest, resourcePath, uniqueName } from './model';

export async function listResources(
  cluster: string,
  namespace: string,
  resource: string,
  signal?: AbortSignal
) {
  const items: Manifest[] = [];
  let next = '';
  do {
    const page = await request(
      `${resourcePath(namespace, resource)}?limit=500${
        next ? `&continue=${encodeURIComponent(next)}` : ''
      }`,
      { cluster, signal, timeout: 20000, autoLogoutOnAuthError: false }
    );
    items.push(...(page.items || []));
    next = page.metadata?.continue || '';
  } while (next);
  return items.sort((a, b) =>
    (b.metadata.creationTimestamp || '').localeCompare(a.metadata.creationTimestamp || '')
  );
}

export async function allowed(
  cluster: string,
  namespace: string,
  resource: string,
  verb: string,
  group = 'velero.io'
) {
  const [resourceName, subresource] = resource.split('/');
  try {
    const response = await request('/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
      cluster,
      method: 'POST',
      autoLogoutOnAuthError: false,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: { group, resource: resourceName, subresource, namespace, verb },
        },
      }),
    });
    return response.status?.allowed === true;
  } catch {
    return false;
  }
}

export function createResource(cluster: string, path: string, value: Manifest, dryRun = false) {
  return request(`${path}${dryRun ? '?dryRun=All&fieldValidation=Strict' : ''}`, {
    cluster,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

export function toggleSchedule(cluster: string, schedule: Manifest) {
  return request(resourcePath(schedule.metadata.namespace!, 'schedules', schedule.metadata.name), {
    cluster,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([
      { op: 'test', path: '/metadata/resourceVersion', value: schedule.metadata.resourceVersion },
      { op: 'add', path: '/spec/paused', value: !schedule.spec?.paused },
    ]),
  });
}

export async function discoverObjectPath(cluster: string, value: Manifest) {
  const base = value.apiVersion.includes('/')
    ? `/apis/${value.apiVersion}`
    : `/api/${value.apiVersion}`;
  const discovery = await request(base, { cluster });
  const resource = discovery.resources?.find(
    (item: any) => item.kind === value.kind && !item.name.includes('/')
  );
  if (!resource)
    throw new Error(`${value.kind} (${value.apiVersion}) is not served by this cluster.`);
  if (resource.namespaced && !value.metadata.namespace)
    throw new Error('This resource requires a target namespace.');
  if (!resource.namespaced && value.metadata.namespace)
    throw new Error('Cluster-scoped resources cannot specify a namespace.');
  return `${base}${
    resource.namespaced ? `/namespaces/${encodeURIComponent(value.metadata.namespace!)}` : ''
  }/${resource.name}`;
}

export async function liveObject(cluster: string, value: Manifest): Promise<Manifest | undefined> {
  const path = await discoverObjectPath(cluster, value);
  try {
    return await request(`${path}/${encodeURIComponent(value.metadata.name)}`, {
      cluster,
      autoLogoutOnAuthError: false,
    });
  } catch (error) {
    if ((error as any).status === 404) return undefined;
    throw error;
  }
}

export async function downloadArtifact(
  cluster: string,
  namespace: string,
  name: string,
  kind: string,
  readerService: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const drName = uniqueName('headlamp');
  const path = resourcePath(namespace, 'downloadrequests');
  await createResource(cluster, path, {
    apiVersion: 'velero.io/v1',
    kind: 'DownloadRequest',
    metadata: { name: drName, namespace },
    spec: { target: { kind, name } },
  });
  const deadline = Date.now() + 45000;
  let url = '';
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Download cancelled.');
    const dr = await request(`${path}/${drName}`, { cluster, signal, timeout: 10000 });
    if (dr.status?.downloadURL && dr.status?.phase === 'Processed') {
      url = dr.status.downloadURL;
      break;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 700));
  }
  if (!url)
    throw new Error(
      'Velero did not provide a download URL within 45 seconds. Check backup storage health and Velero logs.'
    );
  let response: Response;
  if (readerService.trim()) {
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(readerService))
      throw new Error('Invalid artifact reader service name.');
    response = await request(
      `/api/v1/namespaces/${encodeURIComponent(
        namespace
      )}/services/${readerService}:8080/proxy/download/${drName}`,
      { cluster, signal, isJSON: false, timeout: 60000 }
    );
  } else {
    const target = new URL(url);
    if (!['https:', 'http:'].includes(target.protocol))
      throw new Error('Velero returned an unsupported download URL.');
    try {
      response = await fetch(target, {
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new Error(
        'Browser cannot reach backup storage. Configure the artifact reader service, enable storage CORS, or import a downloaded archive.'
      );
    }
    if (!response.ok) throw new Error(`Object storage returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error('Artifact response has no body.');
  return readBounded(response.body, MAX_COMPRESSED, signal);
}
