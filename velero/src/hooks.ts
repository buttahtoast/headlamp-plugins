import { useCallback, useEffect, useState } from 'react';
import { allowed, listResources } from './api';
import { Collection, collections, Data, errorMessage } from './model';

export function useVelero(cluster: string, namespace: string) {
  const [result, setResult] = useState<{
    key: string;
    data: Partial<Data>;
    errors: Partial<Record<Collection, string>>;
    loaded: boolean;
  }>({ key: '', data: {}, errors: {}, loaded: false });
  const [revision, setRevision] = useState(0);
  const key = `${cluster}/${namespace}`;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const values = await Promise.allSettled(
        collections.map(resource => listResources(cluster, namespace, resource, controller.signal))
      );
      if (controller.signal.aborted) return;
      const data: Partial<Data> = {};
      const errors: Partial<Record<Collection, string>> = {};
      values.forEach((value, index) => {
        if (value.status === 'fulfilled') data[collections[index]] = value.value;
        else errors[collections[index]] = errorMessage(value.reason);
      });
      setResult({ key, data, errors, loaded: true });
      timer = setTimeout(load, 15000);
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [cluster, namespace, key, revision]);
  return {
    ...(result.key === key
      ? result
      : {
          data: {} as Partial<Data>,
          errors: {} as Partial<Record<Collection, string>>,
          loaded: false,
        }),
    refresh: useCallback(() => setRevision(v => v + 1), []),
  };
}

export function usePermissions(cluster: string, namespace: string) {
  const [result, setResult] = useState<{ key: string; values: Record<string, boolean> }>({
    key: '',
    values: {},
  });
  const key = `${cluster}/${namespace}`;
  useEffect(() => {
    let active = true;
    const checks = [
      ['backups', 'create'],
      ['schedules', 'create'],
      ['schedules', 'patch'],
      ['restores', 'create'],
      ['downloadrequests', 'create'],
    ];
    Promise.all(
      checks.map(
        async ([resource, verb]) =>
          [`${verb}:${resource}`, await allowed(cluster, namespace, resource, verb)] as const
      )
    ).then(values => {
      if (active) setResult({ key, values: Object.fromEntries(values) });
    });
    return () => {
      active = false;
    };
  }, [cluster, namespace, key]);
  return result.key === key ? result.values : {};
}
