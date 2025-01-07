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

// export function makePodStatusLabel(pod: K8s.ResourceClasses.Pod) {
//   const phase = pod.status.phase;
//   let status: StatusLabelProps['status'] = '';
//   const { reason, message: tooltip } = pod.getDetailedStatus();

//   if (phase === 'Failed') {
//     status = 'error';
//   } else if (phase === 'Succeeded' || phase === 'Running') {
//     const readyCondition = pod.status.conditions.find(condition => condition.type === 'Ready');
//     if (readyCondition?.status === 'True' || phase === 'Succeeded') {
//       status = 'success';
//     } else {
//       status = 'warning';
//     }
//   }

//   return (
//     <LightTooltip title={tooltip} interactive>
//       <Box display="inline">
//         <StatusLabel status={status}>
//           {reason}
//           {(status === 'warning' || status === 'error') && (
//             <Icon aria-label="hidden" icon="mdi:alert-outline" width="1.2rem" height="1.2rem" />
//           )}
//         </StatusLabel>
//       </Box>
//     </LightTooltip>
//   );
// }

// function getReadinessGatesStatus(virtualMachines: VirtualMachine) {
//   const readinessGates =
//     virtualMachines?.spec?.readinessGates?.map(gate => gate.conditionType) || [];
//   const readinessGatesMap: { [key: string]: string } = {};
//   if (readinessGates.length === 0) {
//     return readinessGatesMap;
//   }

//   pods?.status?.conditions?.forEach(condition => {
//     if (readinessGates.includes(condition.type)) {
//       readinessGatesMap[condition.type] = condition.status;
//     }
//   });

//   return readinessGatesMap;
// }

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
  //const { t } = useTranslation(['glossary', 'translation']);
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
        // {
        //   label: t('Restarts'),
        //   getValue: virtualMachine => {
        //     const { restarts, lastRestartDate } = virtualMachine.getDetailedStatus();
        //     return lastRestartDate.getTime() !== 0
        //       ? t('{{ restarts }} ({{ abbrevTime }} ago)', {
        //           restarts: restarts,
        //           abbrevTime: Utils.timeAgo(lastRestartDate, { format: 'mini' }),
        //         })
        //       : restarts;
        //   },
        // },
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
        // {
        //   id: 'readinessGates',
        //   label: t('glossary|Readiness Gates'),
        //   getValue: virtualMachine => {
        //     const readinessGatesStatus = getReadinessGatesStatus(virtualMachine);
        //     const total = Object.keys(readinessGatesStatus).length;

        //     if (total === 0) {
        //       return '';
        //     }

        //     const statusTrueCount = Object.values(readinessGatesStatus).filter(
        //       status => status === 'True'
        //     ).length;

        //     return statusTrueCount;
        //   },
        //   render: virtualMachine => {
        //     const readinessGatesStatus = getReadinessGatesStatus(virtualMachine);
        //     const total = Object.keys(readinessGatesStatus).length;

        //     if (total === 0) {
        //       return null;
        //     }

        //     const statusTrueCount = Object.values(readinessGatesStatus).filter(
        //       status => status === 'True'
        //     ).length;

        //     return (
        //       <LightTooltip
        //         title={Object.keys(readinessGatesStatus)
        //           .map(conditionType => `${conditionType}: ${readinessGatesStatus[conditionType]}`)
        //           .join('\n')}
        //         interactive
        //       >
        //         <span>{`${statusTrueCount}/${total}`}</span>
        //       </LightTooltip>
        //     );
        //   },
        //   sort: (p1: VirtualMachine, p2: VirtualMachine) => {
        //     const readinessGatesStatus1 = getReadinessGatesStatus(p1);
        //     const readinessGatesStatus2 = getReadinessGatesStatus(p2);
        //     const total1 = Object.keys(readinessGatesStatus1).length;
        //     const total2 = Object.keys(readinessGatesStatus2).length;

        //     if (total1 !== total2) {
        //       return total1 - total2;
        //     }

        //     const statusTrueCount1 = Object.values(readinessGatesStatus1).filter(
        //       status => status === 'True'
        //     ).length;
        //     const statusTrueCount2 = Object.values(readinessGatesStatus2).filter(
        //       status => status === 'True'
        //     ).length;

        //     return statusTrueCount1 - statusTrueCount2;
        //   },
        //   show: false,
        // },
        'age',
      ]}
      data={virtualMachine}
      reflectInURL={true}
      id="headlamp-virtualmachines"
    />
  );
}

export default function PodList() {
  const { items, error, clusterErrors } = VirtualMachine.useList({})
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
