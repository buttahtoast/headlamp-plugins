import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

export interface ResourceIdentity {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
  cluster: string;
}
export interface ResourceObject {
  apiVersion?: string;
  kind?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}
export type ReadTransport = (
  path: string,
  options: { cluster: string; method: 'GET'; signal: AbortSignal; autoLogoutOnAuthError: false }
) => Promise<any>;

function versionParts(apiVersion: string) {
  const parts = apiVersion.split('/');
  const version = parts.at(-1);
  const group = parts.length === 2 ? parts[0] : '';
  const dns = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  if (
    !version ||
    !/^[a-z][a-z0-9]*$/.test(version) ||
    parts.length > 2 ||
    (parts.length === 1 && version !== 'v1') ||
    (parts.length === 2 && (!group || !group.split('.').every(label => dns.test(label))))
  )
    throw new Error('A Kubernetes API version is required.');
  return { group, version };
}

/** Capture only identity and cluster; resource values are fetched when the viewer is opened. */
export function resourceIdentity(
  resource: any,
  fallbackCluster: string | null
): ResourceIdentity | undefined {
  try {
    if (!resource) return undefined;
    const value = resource.jsonData || resource;
    const cls = typeof resource._class === 'function' ? resource._class() : resource.constructor;
    const apiVersion = value.apiVersion || [cls?.apiVersion].flat().find(Boolean);
    const kind = value.kind || resource.kind || cls?.kind;
    const cluster = resource.cluster || fallbackCluster;
    const metadata = value.metadata || resource.metadata;
    if (
      typeof apiVersion !== 'string' ||
      typeof kind !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9]*$/.test(kind) ||
      typeof cluster !== 'string' ||
      !cluster ||
      typeof metadata?.name !== 'string' ||
      !metadata.name
    )
      return undefined;
    versionParts(apiVersion);
    return {
      apiVersion,
      kind,
      cluster,
      name: metadata.name,
      namespace: metadata.namespace || undefined,
      uid: metadata.uid || undefined,
    };
  } catch {
    return undefined;
  }
}
export function identityKey(ref: ResourceIdentity) {
  return JSON.stringify([
    ref.cluster,
    ref.apiVersion,
    ref.kind,
    ref.namespace || '',
    ref.name,
    ref.uid || '',
  ]);
}

export function createReader(transport: ReadTransport = request, timeoutMs = 20000) {
  async function get(path: string, cluster: string, signal: AbortSignal) {
    if (signal.aborted) throw new Error('Inspection cancelled.');
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
    try {
      return await transport(path, {
        cluster,
        method: 'GET',
        signal: controller.signal,
        autoLogoutOnAuthError: false,
      });
    } catch (error) {
      if (timedOut) throw new Error('Kubernetes request timed out. Refresh to retry.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  async function load(ref: ResourceIdentity, signal: AbortSignal): Promise<ResourceObject> {
    const { group } = versionParts(ref.apiVersion);
    const tried = new Set<string>();
    async function discover(apiVersion: string) {
      if (tried.has(apiVersion)) return undefined;
      tried.add(apiVersion);
      const base = group ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
      try {
        const api = await get(base, ref.cluster, signal);
        const resource = api.resources?.find(
          (item: any) =>
            item.kind === ref.kind && typeof item.name === 'string' && !item.name.includes('/')
        );
        return resource ? { base, resource } : undefined;
      } catch (error) {
        if (error.status === 404 && !signal.aborted) return undefined;
        throw error;
      }
    }
    let resolved = await discover(ref.apiVersion);
    if (!resolved && group) {
      const api = await get(`/apis/${group}`, ref.cluster, signal);
      const versions: string[] = [
        ...new Set<string>(
          [
            api.preferredVersion?.version,
            ...(api.versions || []).map((version: any) => version.version),
          ].filter(version => typeof version === 'string' && /^[a-z][a-z0-9]*$/.test(version))
        ),
      ];
      for (const version of versions) {
        resolved = await discover(`${group}/${version}`);
        if (resolved) break;
      }
    }
    if (!resolved) throw new Error(`${ref.kind} is not served by this cluster's available APIs.`);
    const { base, resource } = resolved;
    if (resource.namespaced && !ref.namespace)
      throw new Error('This resource requires a namespace. Open its resource detail page first.');
    const namespace = resource.namespaced ? ref.namespace : undefined;
    const path = `${base}${
      namespace ? `/namespaces/${encodeURIComponent(namespace)}` : ''
    }/${encodeURIComponent(resource.name)}/${encodeURIComponent(ref.name)}`;
    const value = await get(path, ref.cluster, signal);
    if (signal.aborted) throw new Error('Inspection cancelled.');
    if (
      value.kind !== ref.kind ||
      value.metadata?.name !== ref.name ||
      (value.metadata?.namespace || '') !== (namespace || '') ||
      !value.apiVersion ||
      versionParts(value.apiVersion).group !== group
    )
      throw new Error('Kubernetes returned an unexpected resource identity.');
    if (ref.uid && value.metadata?.uid !== ref.uid)
      throw new Error(
        'This resource was replaced. Reload its detail page before inspecting the new object.'
      );
    return value;
  }
  return { load };
}
export const reader = createReader();
