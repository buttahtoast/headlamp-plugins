import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { collect, resolveNamespaces, Result, Scope } from './api';
import { Collection } from './model';

function allowedNamespaces(cluster: string): string[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(`cluster_settings.${cluster}`) || '{}'
    ).allowedNamespaces;
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
  } catch {
    return [];
  }
}

export function useScope(singleCluster = false, resourceNamespace?: string) {
  const cluster = K8s.useCluster();
  const selected = K8s.useSelectedClusters();
  const namespaceSet = useSelector(
    ({ filter }: { filter: { namespaces: Set<string> } }) => filter.namespaces
  );
  const namespaces = useMemo(
    () => (resourceNamespace ? [resourceNamespace] : [...namespaceSet].sort()),
    [namespaceSet, resourceNamespace]
  );
  const clusters = [
    ...new Set(!singleCluster && selected.length ? selected : cluster ? [cluster] : []),
  ].sort();
  const scopes = clusters.flatMap(cluster => {
    const allowed = allowedNamespaces(cluster);
    const visible = resolveNamespaces(namespaces, allowed);
    return visible ? [{ cluster, namespaces: visible }] : [];
  });
  const key = JSON.stringify(scopes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return { scopes: useMemo(() => scopes, [key]), namespaces, clusters };
}

export function useCertManager(scopes: Scope[]) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    results: Partial<Record<Collection, Result>>;
    loading: boolean;
    updatedAt?: number;
  }>({ key: '', results: {}, loading: true });
  const key = JSON.stringify(scopes);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setState(previous => ({
      key,
      results: previous.key === key ? previous.results : {},
      loading: true,
      updatedAt: previous.key === key ? previous.updatedAt : undefined,
    }));
    void collect(
      scopes,
      (id, result) => {
        if (!abort.signal.aborted)
          setState(previous => ({ ...previous, results: { ...previous.results, [id]: result } }));
      },
      abort.signal
    ).finally(() => {
      if (!abort.signal.aborted) {
        setState(previous => ({ ...previous, loading: false, updatedAt: Date.now() }));
        timer = setTimeout(() => setRevision(value => value + 1), 30000);
      }
    });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
    // The serialized scope includes selected clusters and allowed namespaces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  return {
    ...(state.key === key ? state : { key, results: {}, loading: true, updatedAt: undefined }),
    refresh: useCallback(() => setRevision(value => value + 1), []),
  };
}
