//import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  //LightTooltip,
  Link,
  ResourceTableProps,
  SimpleTableProps,
  //StatusLabel,
  //StatusLabelProps,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
//import { Box } from '@mui/material';
//import { useTranslation } from 'react-i18next';
import VirtualMachine from './VirtualMachine';

export interface PodListProps {
  virtualMachine: VirtualMachine[] | null;
  error: ApiError | null;
  hideColumns?: ['namespace'];
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
  noNamespaceFilter?: boolean;
  clusterErrors?: ResourceTableProps<VirtualMachine>['clusterErrors'];
}

export function PodListRenderer(props: PodListProps) {
  const { virtualMachine, error, hideColumns = [], noNamespaceFilter } = props;
  return (
    <Resource.ResourceListView
      title={'Virtual Machines'}
      headerProps={{
        noNamespaceFilter,
      }}
      hideColumns={hideColumns}
      errorMessage={K8s.ResourceClasses.Pod.getErrorMessage(error)}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: virtualMachine => virtualMachine.getName(),
          render: virtualMachine => (
            <Link
              routeName="/kubevirt/virtualmachines/:namespace/:name"
              params={{ name: virtualMachine.getName(), namespace: virtualMachine.getNamespace() }}
            >
              {virtualMachine.getName()}
            </Link>
          ),
        },
        'namespace',
        'cluster',
        {
          id: 'ready',
          label: 'Ready',
          getValue: virtualMachine => virtualMachine.status?.ready ?? 'unknown',
        },
        {
          id: 'status',
          label: 'Status',
          getValue: virtualMachine => virtualMachine.status?.printableStatus,
        },
        {
          id: 'ip',
          label: 'IP',
          getValue: virtualMachine => virtualMachine.status?.podIP ?? '',
        },
        {
          id: 'node',
          label: 'Node',
          getValue: virtualMachine => virtualMachine?.spec?.nodeName,
          render: virtualMachine =>
            virtualMachine?.spec?.nodeName && (
              <Link routeName="node" params={{ name: virtualMachine.spec.nodeName }} tooltip>
                {virtualMachine.spec.nodeName}
              </Link>
            ),
        },
        {
          id: 'nominatedNode',
          label: 'Nominated Node',
          getValue: virtualMachine => virtualMachine?.status?.nominatedNodeName,
          render: virtualMachine =>
            !!virtualMachine?.status?.nominatedNodeName && (
              <Link
                routeName="node"
                params={{ name: virtualMachine?.status?.nominatedNodeName }}
                tooltip
              >
                {virtualMachine?.status?.nominatedNodeName}
              </Link>
            ),
          show: false,
        },

        'age',
      ]}
      data={virtualMachine}
      reflectInURL
      id="headlamp-virtualmachines"
    />
  );
}

export default function PodList() {
  const { items, error, clusterErrors } = VirtualMachine.useList({});
  return (
    <PodListRenderer
      virtualMachine={items}
      error={error}
      clusterErrors={clusterErrors}
      reflectTableInURL
      noNamespaceFilter={false}
    />
  );
}
