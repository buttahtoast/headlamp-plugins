import { Link, SimpleTableProps } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import { Chip, Typography } from '@mui/material';
import VirtualMachineClusterInstancetype from './VirtualMachineClusterInstancetype';

export interface VirtualMachineClusterInstancetypeListProps {
  items: VirtualMachineClusterInstancetype[] | null;
  error: ApiError | null;
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
}

export function VirtualMachineClusterInstancetypeListRenderer(
  props: VirtualMachineClusterInstancetypeListProps
) {
  const { items, error } = props;

  return (
    <Resource.ResourceListView
      title={'VM Instance Types'}
      headerProps={{
        noNamespaceFilter: true,
      }}
      errorMessage={error?.message || (error ? String(error) : '')}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => (
            <Link
              routeName="virtualmachineclusterinstancetype"
              params={{ name: item.getName() }}
            >
              {item.getName()}
            </Link>
          ),
        },
        'cluster',
        {
          id: 'cpu',
          label: 'CPU (vCPUs)',
          gridTemplate: '0.5fr',
          getValue: item => item.getCPU().guest,
          render: item => {
            const cpu = item.getCPU();
            return (
              <Chip
                label={`${cpu.guest} vCPU${cpu.dedicatedCPUPlacement ? ' (dedicated)' : ''}`}
                size="small"
                variant="outlined"
                color="primary"
              />
            );
          },
        },
        {
          id: 'memory',
          label: 'Memory',
          gridTemplate: '0.5fr',
          getValue: item => item.getMemory().guest,
          render: item => {
            const memory = item.getMemory();
            return (
              <Chip
                label={`${memory.guest}${memory.hugepages ? ` (${memory.hugepages.pageSize})` : ''}`}
                size="small"
                variant="outlined"
                color="info"
              />
            );
          },
        },
        {
          id: 'features',
          label: 'Features',
          getValue: item => {
            const features = [];
            if (item.hasDedicatedCPU()) features.push('Dedicated CPU');
            if (item.hasHugepages()) features.push('Hugepages');
            if (item.getGPUs().length > 0) features.push('GPU');
            if (item.getHostDevices().length > 0) features.push('Host Devices');
            return features.join(', ');
          },
          render: item => {
            const features = [];
            if (item.hasDedicatedCPU()) features.push('Dedicated CPU');
            if (item.hasHugepages()) features.push('Hugepages');
            if (item.getGPUs().length > 0) features.push('GPU');
            if (item.getHostDevices().length > 0) features.push('Host Devices');

            if (features.length === 0) {
              return <Typography variant="caption" color="text.secondary">-</Typography>;
            }

            return features.map((f, idx) => (
              <Chip
                key={idx}
                label={f}
                size="small"
                variant="outlined"
                color="warning"
                sx={{ mr: 0.5, mb: 0.5 }}
              />
            ));
          },
        },
        {
          id: 'ioThreads',
          label: 'IO Threads',
          gridTemplate: '0.5fr',
          getValue: item => item.getIOThreadsPolicy(),
          render: item => {
            const policy = item.getIOThreadsPolicy();
            return policy !== '-' ? (
              <Chip label={policy} size="small" variant="outlined" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        'age',
      ]}
      data={items}
      reflectInURL
      id="headlamp-virtualmachineclusterinstancetypes"
    />
  );
}

export default function VirtualMachineClusterInstancetypeList() {
  const { items, error } = VirtualMachineClusterInstancetype.useList({});

  return (
    <VirtualMachineClusterInstancetypeListRenderer
      items={items}
      error={error}
      reflectTableInURL
    />
  );
}
