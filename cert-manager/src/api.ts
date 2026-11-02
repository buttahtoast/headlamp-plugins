import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Collection, collections, Item, Manifest, renewalPatch, resourcePath } from './model';

export interface Scope {
  cluster: string;
  namespaces: string[];
}
export interface Result {
  items: Item[];
  error?: string;
  missing?: boolean;
}
export const options = { timeout: 15000, autoLogoutOnAuthError: false };

export function resolveNamespaces(selected: string[], allowed: string[]): string[] | null {
  if (!selected.length) return allowed;
  const values = allowed.length ? selected.filter(value => allowed.includes(value)) : selected;
  return values.length ? values : null;
}

export async function listPath(
  cluster: string,
  path: string,
  signal?: AbortSignal
): Promise<Item[]> {
  const items: Item[] = [];
  let next = '';
  const seen = new Set<string>();
  do {
    if (signal?.aborted) throw new Error('Request cancelled.');
    const page = await request(
      `${path}${path.includes('?') ? '&' : '?'}limit=500${
        next ? `&continue=${encodeURIComponent(next)}` : ''
      }`,
      { ...options, cluster, signal }
    );
    if (!Array.isArray(page.items))
      throw new Error('Kubernetes returned an invalid resource list.');
    items.push(...page.items.map((item: Manifest) => ({ ...item, cluster })));
    next = page.metadata?.continue || '';
    if (next && seen.has(next)) throw new Error('Kubernetes returned a repeated pagination token.');
    seen.add(next);
  } while (next);
  return items;
}

// Bound concurrent requests, including per-namespace requests on restricted clusters.
export async function collect(
  scopes: Scope[],
  publish: (id: string, result: Result) => void,
  signal: AbortSignal
) {
  const jobs = scopes.flatMap(scope =>
    (Object.keys(collections) as Collection[]).flatMap(id => {
      const descriptor = collections[id as Collection];
      const namespaces = descriptor.namespaced ? scope.namespaces : [];
      return (namespaces.length ? namespaces : ['']).map(namespace => ({
        id,
        cluster: scope.cluster,
        path: resourcePath(id, namespace),
      }));
    })
  );
  const buckets = new Map<string, Result>();
  let index = 0;
  const deadline = new AbortController();
  const cancel = () => deadline.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) deadline.abort();
  const timer = setTimeout(cancel, 20000);
  async function worker() {
    while (index < jobs.length && !signal.aborted) {
      const job = jobs[index++];
      const bucket = buckets.get(job.id) || { items: [] };
      buckets.set(job.id, bucket);
      try {
        const items = await listPath(job.cluster, job.path, deadline.signal);
        bucket.items.push(...items);
      } catch (error) {
        const status = (error as any)?.status || (error as any)?.response?.status;
        if (status === 404) bucket.missing = true;
        else
          bucket.error = [
            bucket.error,
            `${job.cluster}: ${(error as any)?.message || String(error)}`,
          ]
            .filter(Boolean)
            .join('; ');
      }
      if (!signal.aborted) publish(job.id, { ...bucket, items: [...bucket.items] });
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

export function getResource(
  cluster: string,
  collection: Collection,
  namespace: string | undefined,
  name: string,
  signal?: AbortSignal
): Promise<Manifest> {
  return request(resourcePath(collection, namespace, name), { ...options, cluster, signal });
}

export async function allowed(
  cluster: string,
  namespace: string | undefined,
  resource: string,
  verb: string,
  name?: string
) {
  const [plural, subresource] = resource.split('/');
  const review = await request('/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
    ...options,
    cluster,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SelfSubjectAccessReview',
      spec: {
        resourceAttributes: {
          group: 'cert-manager.io',
          resource: plural,
          subresource,
          namespace,
          name,
          verb,
        },
      },
    }),
  });
  return review.status?.allowed === true;
}

export function patchRenewal(
  cluster: string,
  item: Manifest,
  patch: ReturnType<typeof renewalPatch>,
  dryRun: boolean
) {
  return request(
    `${resourcePath('certificates', item.metadata.namespace, item.metadata.name)}/status${
      dryRun ? '?dryRun=All&fieldValidation=Strict' : ''
    }`,
    {
      ...options,
      cluster,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(patch),
    }
  );
}

export async function prepareRenewal(item: Item) {
  const live = await getResource(
    item.cluster,
    'certificates',
    item.metadata.namespace,
    item.metadata.name
  );
  if (live.metadata.uid !== item.metadata.uid)
    throw new Error('The certificate was replaced. Refresh before renewing.');
  if (
    !(await allowed(
      item.cluster,
      live.metadata.namespace,
      'certificates/status',
      'patch',
      live.metadata.name
    ))
  )
    throw new Error('Your Kubernetes user cannot patch certificates/status in this namespace.');
  const patch = renewalPatch(live);
  await patchRenewal(item.cluster, live, patch, true);
  return { live, patch };
}

export function createCertificate(cluster: string, item: Manifest, dryRun: boolean) {
  return request(
    `${resourcePath('certificates', item.metadata.namespace)}${
      dryRun ? '?dryRun=All&fieldValidation=Strict' : ''
    }`,
    {
      ...options,
      cluster,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    }
  );
}
