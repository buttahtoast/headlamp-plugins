import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { ResourceData } from '../common/health';

export interface CollectionSpec {
  id: string;
  kind: string;
  plural: string;
  versions: string[];
  namespaced: boolean;
  labelSelector?: string;
}
export interface CollectionError {
  status?: number;
  message: string;
}
export interface CollectionResult {
  items: ResourceData[];
  error?: CollectionError;
  missing?: boolean;
}
export interface ClusterScope {
  cluster: string;
  namespaces?: string[];
  controllerNamespaces?: string[];
}
export type Transport = (
  path: string,
  options: { cluster: string; method: 'GET'; signal: AbortSignal; autoLogoutOnAuthError: false }
) => Promise<any>;
const failure = (error: any): CollectionError => ({
  status: error?.status,
  message: error?.message || String(error),
});
const timeout = () => ({ status: 408, message: 'Request timed out. Refresh to retry.' });

/** Dashboard snapshots settle independently of watch connections and optional endpoints. */
export function createOverviewClient(
  transport: Transport = request,
  timeoutMs = 15000,
  cycleTimeoutMs = 20000
) {
  async function get(path: string, cluster: string, signal: AbortSignal, remaining: number) {
    if (signal.aborted) throw new Error('Dashboard request cancelled.');
    if (remaining <= 0) throw timeout();
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let cancel: () => void;
    const pending = new Promise<never>((_, reject) => {
      cancel = () => {
        abort.abort();
        reject(new Error('Dashboard request cancelled.'));
      };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        abort.abort();
        reject(timeout());
      }, Math.min(timeoutMs, remaining));
    });
    try {
      return await Promise.race([
        transport(path, {
          cluster,
          method: 'GET',
          signal: abort.signal,
          autoLogoutOnAuthError: false,
        }),
        pending,
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }

  async function load(
    spec: CollectionSpec,
    scope: ClusterScope,
    signal: AbortSignal
  ): Promise<CollectionResult> {
    const deadline = Date.now() + timeoutMs;
    const items: ResourceData[] = [];
    const requested = spec.id === 'controllers' ? scope.controllerNamespaces : scope.namespaces;
    const namespaces = spec.namespaced && requested?.length ? [...new Set(requested)] : [undefined];
    const errors: CollectionError[] = [];
    let version: string | undefined;
    let missing = 0;
    for (const namespace of namespaces) {
      try {
        let listed = false;
        for (const apiVersion of version ? [version] : spec.versions) {
          const base = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
          const path = `${base}${namespace ? `/namespaces/${encodeURIComponent(namespace)}` : ''}/${
            spec.plural
          }`;
          const seen = new Set<string>();
          let continuation = '';
          try {
            do {
              const query = new URLSearchParams({
                limit: '500',
                ...(spec.labelSelector ? { labelSelector: spec.labelSelector } : {}),
                ...(continuation ? { continue: continuation } : {}),
              });
              const response = await get(
                `${path}?${query}`,
                scope.cluster,
                signal,
                deadline - Date.now()
              );
              if (!Array.isArray(response?.items))
                throw new Error(`Invalid ${spec.kind} list response.`);
              version = apiVersion;
              for (const value of response.items) {
                if (!value?.metadata?.name || (value.kind && value.kind !== spec.kind))
                  throw new Error(`Invalid ${spec.kind} object in list response.`);
                if (namespace && value.metadata.namespace !== namespace)
                  throw new Error(`Unexpected namespace in ${spec.kind} response.`);
                items.push({
                  ...value,
                  apiVersion: value.apiVersion || response.apiVersion || apiVersion,
                  kind: value.kind || spec.kind,
                  cluster: scope.cluster,
                });
              }
              continuation = response.metadata?.continue || '';
              if (continuation && seen.has(continuation))
                throw new Error(`Repeated continuation token for ${spec.kind}.`);
              seen.add(continuation);
            } while (continuation && !signal.aborted);
            listed = true;
            break;
          } catch (error) {
            if (error.status === 404 && !version && apiVersion !== spec.versions.at(-1)) continue;
            throw error;
          }
        }
        if (!listed && !signal.aborted) throw new Error(`Could not load ${spec.kind}.`);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.status === 404) missing++;
        else errors.push(failure(error));
        if (error.status === 408) break;
      }
    }
    const unique = [
      ...new Map(
        items.map(item => [
          `${item.cluster}/${
            item.metadata?.uid ||
            `${item.kind}/${item.metadata?.namespace || ''}/${item.metadata?.name}`
          }`,
          item,
        ])
      ).values(),
    ];
    return {
      items: unique,
      ...(errors.length
        ? {
            error: {
              status: errors[0].status,
              message: errors.map(error => error.message).join(' '),
            },
          }
        : {}),
      missing: !unique.length && missing === namespaces.length,
    };
  }

  async function run(
    specs: CollectionSpec[],
    scopes: ClusterScope[],
    publish: (id: string, result: CollectionResult) => void,
    signal: AbortSignal
  ) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) abort.abort();
    const timer = setTimeout(cancel, cycleTimeoutMs);
    let next = 0;
    const jobs = specs.flatMap(spec =>
      scopes.map((scope, index) => ({ spec, scope, key: `${spec.id}/${index}` }))
    );
    const results = new Map<string, CollectionResult>();
    function complete(job: (typeof jobs)[number], result: CollectionResult) {
      if (signal.aborted) return;
      results.set(job.key, result);
      const combined = jobs
        .filter(item => item.spec.id === job.spec.id && results.has(item.key))
        .map(item => results.get(item.key));
      const errors = combined.filter(result => result.error);
      publish(job.spec.id, {
        items: combined.flatMap(result => result.items),
        missing: combined.length === scopes.length && combined.every(result => result.missing),
        ...(errors.length
          ? {
              error: {
                status: errors[0].error.status,
                message: errors.map(result => result.error.message).join(' '),
              },
            }
          : {}),
      });
    }
    async function worker() {
      while (next < jobs.length && !abort.signal.aborted) {
        const job = jobs[next++];
        try {
          complete(job, await load(job.spec, job.scope, abort.signal));
        } catch (error) {
          if (!abort.signal.aborted) complete(job, { items: [], error: failure(error) });
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
      if (!signal.aborted)
        for (const job of jobs)
          if (!results.has(job.key)) complete(job, { items: [], error: timeout() });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }
  return { load, run };
}
export const overviewClient = createOverviewClient();
