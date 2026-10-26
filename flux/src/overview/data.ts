import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import { useNamespaces } from '../helpers';
import { ClusterScope, CollectionResult, CollectionSpec, overviewClient } from './client';
import { RESOURCE_GROUPS } from './registry';
export { RESOURCE_GROUPS } from './registry';

export const COLLECTIONS: CollectionSpec[] = [
  ...RESOURCE_GROUPS.map(group => ({
    id: group.id,
    kind: group.resourceClass.kind,
    plural: group.resourceClass.apiName,
    versions: [group.resourceClass.apiVersion].flat(),
    namespaced: true,
  })),
  {
    id: 'controllers',
    kind: 'Deployment',
    plural: 'deployments',
    versions: ['apps/v1'],
    namespaced: true,
    labelSelector: 'app.kubernetes.io/part-of=flux',
  },
];

function allowedNamespaces(cluster: string): string[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(`cluster_settings.${cluster}`) || '{}'
    ).allowedNamespaces;
    return Array.isArray(value)
      ? value.filter(namespace => typeof namespace === 'string' && namespace)
      : [];
  } catch {
    return [];
  }
}

export function useFluxOverview() {
  const cluster = K8s.useCluster();
  const selectedClusters = K8s.useSelectedClusters();
  const namespaces = useNamespaces();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    results: Record<string, CollectionResult>;
    loading: boolean;
    updatedAt?: number;
  }>({ key: '', results: {}, loading: true });
  const clusters = [
    ...new Set(selectedClusters.length ? selectedClusters : cluster ? [cluster] : []),
  ].sort();
  const scopes: ClusterScope[] = clusters.map(cluster => {
    const allowed = allowedNamespaces(cluster);
    const requested = namespaces?.length ? namespaces : allowed;
    return {
      cluster,
      controllerNamespaces: allowed,
      namespaces:
        allowed.length && namespaces?.length
          ? requested.filter(namespace => allowed.includes(namespace))
          : requested,
    };
  });
  const key = JSON.stringify(scopes);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const active = scopes.filter(
      scope =>
        !namespaces?.length ||
        !allowedNamespaces(scope.cluster).length ||
        scope.namespaces.length > 0
    );
    setState(previous => ({
      key,
      results: previous.key === key ? previous.results : {},
      loading: true,
      updatedAt: previous.key === key ? previous.updatedAt : undefined,
    }));
    if (!active.length) {
      setState({
        key,
        results: Object.fromEntries(COLLECTIONS.map(spec => [spec.id, { items: [] }])),
        loading: false,
        updatedAt: Date.now(),
      });
      return () => abort.abort();
    }
    void overviewClient
      .run(
        COLLECTIONS,
        active,
        (id, result) =>
          setState(previous =>
            abort.signal.aborted || previous.key !== key
              ? previous
              : { ...previous, results: { ...previous.results, [id]: result } }
          ),
        abort.signal
      )
      .catch(error => {
        if (!abort.signal.aborted)
          setState(previous => ({
            ...previous,
            results: Object.fromEntries(
              COLLECTIONS.map(spec => [
                spec.id,
                previous.results[spec.id] || {
                  items: [],
                  error: { message: error.message || String(error) },
                },
              ])
            ),
          }));
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setState(previous => ({ ...previous, loading: false, updatedAt: Date.now() }));
          timer = setTimeout(() => setRevision(previous => previous + 1), 30000);
        }
      });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
    // Scope strings remain stable when Headlamp recreates its selected-cluster arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  const current = state.key === key ? state : { key, results: {}, loading: true };
  return {
    groups: RESOURCE_GROUPS.map(group => ({
      ...group,
      items: current.results[group.id]?.items ?? null,
      error: current.results[group.id]?.error,
      missing: current.results[group.id]?.missing || false,
    })),
    controllers: current.results.controllers?.items ?? null,
    controllerError: current.results.controllers?.error,
    loading: current.loading,
    updatedAt: current.updatedAt,
    refresh: () => setRevision(previous => previous + 1),
  };
}
