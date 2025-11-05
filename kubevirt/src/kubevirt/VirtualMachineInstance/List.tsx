//import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link, SimpleTableProps } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import VirtualMachineInstance from './VirtualMachineInstance';

export interface VirtualMachineInstanceListProps {
  virtualMachineInstances: VirtualMachineInstance[] | null;
  error: ApiError | null;
  hideColumns?: ['namespace'];
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
  noNamespaceFilter?: boolean;
}

export function VirtualMachineInstanceListRenderer(props: VirtualMachineInstanceListProps) {
  const { virtualMachineInstances, error, hideColumns = [], noNamespaceFilter } = props;
  //const { t } = useTranslation(['glossary', 'translation']);
  return (
    <Resource.ResourceListView
      title={'Virtual Machine Instances'}
      headerProps={{
        noNamespaceFilter,
      }}
      hideColumns={hideColumns}
      errorMessage={K8s.ResourceClasses.Pod.getErrorMessage(error)}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: virtualMachineInstance => virtualMachineInstance.getName(),
          render: virtualMachineInstance => (
            <Link
              routeName="/kubevirt/virtualmachineinstances/:namespace/:name"
              params={{
                name: virtualMachineInstance.getName(),
                namespace: virtualMachineInstance.getNamespace(),
              }}
            >
              {virtualMachineInstance.getName()}
            </Link>
          ),
        },
        'namespace',
        'cluster',
        {
          id: 'ready',
          label: 'Ready',
          getValue: virtualMachineInstance => virtualMachineInstance.status?.ready ?? 'unknown',
        },
        {
          id: 'status',
          label: 'Status',
          getValue: virtualMachineInstance => virtualMachineInstance.status?.printableStatus,
        },
        {
          id: 'ip',
          label: 'IP',
          getValue: virtualMachineInstance => virtualMachineInstance.status?.podIP ?? '',
        },
        {
          id: 'node',
          label: 'Node',
          getValue: virtualMachineInstance => virtualMachineInstance?.spec?.nodeName,
          render: virtualMachineInstance =>
            virtualMachineInstance?.spec?.nodeName && (
              <Link
                routeName="node"
                params={{ name: virtualMachineInstance.spec.nodeName }}
                tooltip
              >
                {virtualMachineInstance.spec.nodeName}
              </Link>
            ),
        },
        {
          id: 'nominatedNode',
          label: 'Nominated Node',
          getValue: virtualMachineInstance => virtualMachineInstance?.status?.nominatedNodeName,
          render: virtualMachineInstance =>
            !!virtualMachineInstance?.status?.nominatedNodeName && (
              <Link
                routeName="node"
                params={{ name: virtualMachineInstance?.status?.nominatedNodeName }}
                tooltip
              >
                {virtualMachineInstance?.status?.nominatedNodeName}
              </Link>
            ),
          show: false,
        },
        'age',
      ]}
      data={virtualMachineInstances}
      reflectInURL
      id="headlamp-virtualmachines"
    />
  );
}

export default function VirtualMachineInstanceList() {
  const { items, error } = VirtualMachineInstance.useList({});
  return (
    <VirtualMachineInstanceListRenderer
      virtualMachineInstances={items}
      error={error}
      reflectTableInURL
      noNamespaceFilter={false}
    />
  );
}
