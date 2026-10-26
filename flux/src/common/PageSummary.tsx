import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useCallback, useEffect, useState } from 'react';
import { useNamespaces } from '../helpers';
import { ResourceData } from './health';
import { ListStats } from './ListStats';

type CollectionResult = { resources: ResourceData[] | null; error?: any };

function Collector({
  resourceClass,
  onResult,
}: {
  resourceClass: KubeObjectClass;
  onResult: (kind: string, value: CollectionResult) => void;
}) {
  const [resources, error] = resourceClass.useList({ namespace: useNamespaces() });
  const version = JSON.stringify([
    resources === null
      ? null
      : resources?.map(item => [item.metadata.uid, item.metadata.resourceVersion]),
    error?.status,
    error?.message,
  ]);
  useEffect(() => {
    onResult(resourceClass.kind, { resources, error });
    // SDK list arrays may be recreated without a resource version changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, resourceClass, onResult]);
  return null;
}

export function PageSummary({
  resourceClasses,
  label,
}: {
  resourceClasses: KubeObjectClass[];
  label: string;
}) {
  const cluster = K8s.useCluster();
  const namespaces = useNamespaces();
  return (
    <Summary
      key={`${cluster}/${namespaces?.join(',') || '*'}`}
      resourceClasses={resourceClasses}
      label={label}
    />
  );
}

function Summary({
  resourceClasses,
  label,
}: {
  resourceClasses: KubeObjectClass[];
  label: string;
}) {
  const [results, setResults] = useState<Record<string, CollectionResult>>({});
  const onResult = useCallback(
    (kind: string, value: CollectionResult) =>
      setResults(previous => ({ ...previous, [kind]: value })),
    []
  );
  const values = Object.values(results);
  const loading =
    values.length < resourceClasses.length ||
    values.some(value => value.resources === null && !value.error);
  const errors = values.filter(value => value.error && value.error.status !== 404);
  return (
    <>
      {resourceClasses.map(resourceClass => (
        <Collector key={resourceClass.kind} resourceClass={resourceClass} onResult={onResult} />
      ))}
      <ListStats
        label={label}
        resources={values.flatMap(value => value.resources || [])}
        loading={loading}
        error={
          errors.length
            ? {
                message: `${errors.length} resource lists could not be loaded. Statistics cover the resources visible to your user.`,
              }
            : undefined
        }
      />
    </>
  );
}
