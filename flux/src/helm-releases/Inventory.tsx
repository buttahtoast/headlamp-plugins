import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { useEffect, useState } from 'react';
import { jsonData, ResourceData } from '../common/health';
import { PluralName } from '../helpers/pluralName';
import { decodeHelmRelease, helmManifestReferences } from '../inventory/api';
import { InventoryPanel } from '../inventory/InventoryPanel';
import { ObjectRef, releaseIdentity } from '../inventory/model';

interface HelmResourceKind extends KubeObjectInterface {
  groupName: string;
}

export function HelmInventory({
  name,
  namespace,
  resource,
}: {
  name: string;
  namespace: string;
  resource?: ResourceData;
}) {
  const owner = resource || { kind: 'HelmRelease', metadata: { name, namespace } };
  const identity = releaseIdentity(owner);
  const cluster = K8s.useCluster();
  const [secrets, secretError] = K8s.ResourceClasses.Secret.useList({
    namespace: identity.namespace,
    labelSelector: `name=${identity.name},owner=helm`,
  });
  const revision = jsonData(owner).status?.history?.[0]?.version;
  const secret =
    secrets?.find(secret => Number(secret.metadata.labels?.version) === revision) ||
    secrets
      ?.slice()
      .sort(
        (a, b) => Number(b.metadata.labels?.version || 0) - Number(a.metadata.labels?.version || 0)
      )[0];
  const encoded = secret?.jsonData?.data?.release;
  const key = `${cluster}/${identity.namespace}/${identity.name}/${secret?.metadata.uid || ''}/${
    secret?.metadata.resourceVersion || ''
  }`;
  const [result, setResult] = useState<{ key: string; references: ObjectRef[]; error?: string }>({
    key: '',
    references: [],
  });
  useEffect(() => {
    let active = true;
    if (encoded)
      decodeHelmRelease(encoded)
        .then(release => {
          const references = helmManifestReferences(release.manifest, identity.targetNamespace);
          if (active) setResult({ key, references });
        })
        .catch(error => {
          if (active) setResult({ key, references: [], error: error.message });
        });
    return () => {
      active = false;
    };
  }, [encoded, key, identity.targetNamespace]);
  const references = result.key === key ? result.references : [];
  const error = secretError
    ? `Cannot read Helm release records in ${identity.namespace}: ${secretError.message}`
    : secrets && !secrets.length
    ? `No accessible Helm release record for ${identity.namespace}/${identity.name}.`
    : result.key === key
    ? result.error
    : undefined;
  return (
    <InventoryPanel
      owner={owner}
      references={references}
      error={error}
      loading={!secretError && (!secrets || (!!encoded && result.key !== key))}
    />
  );
}

export function inventoryNameLink(item: HelmResourceKind): React.ReactNode {
  const kind = item.kind;
  const groupName = item.groupName;
  const pluralName = PluralName(kind);

  // Flux types
  const allowedDomain = 'toolkit.fluxcd.io';
  if (groupName === allowedDomain || groupName.endsWith(`.${allowedDomain}`)) {
    const routeName =
      groupName === allowedDomain ? 'toolkit' : groupName.substring(0, groupName.indexOf('.'));

    return (
      <Link
        routeName={routeName}
        params={{
          pluralName: pluralName,
          name: item.metadata.name,
          namespace: item.metadata.namespace,
        }}
      >
        {item.metadata.name}
      </Link>
    );
  }

  // Standard k8s types
  const resourceClass = K8s.ResourceClasses[kind];
  if (resourceClass) {
    const resource = new resourceClass(item);
    // skip namespaced details link when cluster-scoped resource has no namespace
    const canBuildLink = !(resource.isNamespaced && !item.metadata.namespace);
    if (canBuildLink && resource?.getDetailsLink?.()) {
      return <Link kubeObject={resource}>{item.metadata.name}</Link>;
    }
    return item.metadata.name;
  }

  // Custom resources
  return (
    <Link
      routeName="customresource"
      params={{
        crName: item.metadata.name,
        crd: `${pluralName}.${groupName}`,
        namespace: item.metadata.namespace || '-',
      }}
    >
      {item.metadata.name}
    </Link>
  );
}
