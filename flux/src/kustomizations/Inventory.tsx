import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { useMemo } from 'react';
import { PluralName } from '../helpers/pluralName';
import { InventoryPanel } from '../inventory/InventoryPanel';
import { parseInventoryEntry } from '../inventory/model';

export function GetResourcesFromInventory({
  inventory = [],
  resource,
}: {
  inventory?: { id: string; v: string }[];
  resource?: KubeObject;
}) {
  const { references, errors } = useMemo(() => {
    const errors: string[] = [];
    const references = [];
    for (const entry of inventory) {
      try {
        references.push(parseInventoryEntry(entry));
      } catch (error) {
        errors.push(error.message);
      }
    }
    return { references: [...new Map(references.map(ref => [ref.id, ref])).values()], errors };
  }, [inventory]);
  return (
    <InventoryPanel
      owner={resource || { kind: 'Kustomization', metadata: { name: 'Inventory' } }}
      references={references}
      error={errors.length ? errors.join('; ') : undefined}
    />
  );
}

export function inventoryNameLink(item: KubeObject) {
  // return the name and not a link if we could not query the resource
  if (!item.metadata.creationTimestamp) {
    return item.metadata.name;
  }

  const kind = item.kind;
  const itemJsonData: KubeObjectInterface = item.jsonData;
  // remove version from apiVersion to get the groupName
  const apiVersion = itemJsonData.apiVersion;
  const slashIndex = apiVersion.lastIndexOf('/');
  const groupName = slashIndex > 0 ? apiVersion.substring(0, slashIndex) : apiVersion;
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

  // CRD
  if (kind === 'CustomResourceDefinition') {
    return (
      <Link
        routeName="crd"
        params={{
          name: item.metadata.name,
        }}
      >
        {item.metadata.name}
      </Link>
    );
  }

  // Standard k8s types
  const resourceKind = K8s.ResourceClasses[kind];
  if (resourceKind) {
    const resource = new resourceKind(item);
    // skip namespaced details link when cluster scoped resource has no namespace
    const canBuildLink = !(resource.isNamespaced && !item.metadata.namespace);
    if (canBuildLink && resource?.getDetailsLink && resource.getDetailsLink()) {
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
