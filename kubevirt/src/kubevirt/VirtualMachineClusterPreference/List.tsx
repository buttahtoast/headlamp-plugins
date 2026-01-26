import { Link, SimpleTableProps } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import { Chip, Typography } from '@mui/material';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading } from '../utils/kubeVirtCheck';
import VirtualMachineClusterPreference from './VirtualMachineClusterPreference';

export interface VirtualMachineClusterPreferenceListProps {
  items: VirtualMachineClusterPreference[] | null;
  error: ApiError | null;
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
}

export function VirtualMachineClusterPreferenceListRenderer(
  props: VirtualMachineClusterPreferenceListProps
) {
  const { items, error } = props;

  return (
    <Resource.ResourceListView
      title={'VM Preferences'}
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
              routeName="virtualmachineclusterpreference"
              params={{ name: item.getName() }}
            >
              {item.getName()}
            </Link>
          ),
        },
        'cluster',
        {
          id: 'machineType',
          label: 'Machine Type',
          getValue: item => item.getPreferredMachineType(),
          render: item => {
            const machineType = item.getPreferredMachineType();
            return machineType !== '-' ? (
              <Chip label={machineType} size="small" variant="outlined" color="primary" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'diskBus',
          label: 'Disk Bus',
          gridTemplate: '0.5fr',
          getValue: item => item.getPreferredDiskBus(),
          render: item => {
            const bus = item.getPreferredDiskBus();
            return bus !== '-' ? (
              <Chip label={bus} size="small" variant="outlined" color="info" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'networkModel',
          label: 'Network Model',
          gridTemplate: '0.5fr',
          getValue: item => item.getPreferredInterfaceModel(),
          render: item => {
            const model = item.getPreferredInterfaceModel();
            return model !== '-' ? (
              <Chip label={model} size="small" variant="outlined" color="info" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'firmware',
          label: 'Firmware',
          getValue: item => {
            const features = [];
            if (item.prefersUEFI()) features.push('UEFI');
            if (item.prefersSecureBoot()) features.push('Secure Boot');
            return features.join(', ') || '-';
          },
          render: item => {
            const features = [];
            if (item.prefersUEFI()) features.push('UEFI');
            if (item.prefersSecureBoot()) features.push('Secure Boot');

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
                sx={{ mr: 0.5 }}
              />
            ));
          },
        },
        {
          id: 'cpuTopology',
          label: 'CPU Topology',
          gridTemplate: '0.5fr',
          getValue: item => item.getPreferredCPUTopology(),
          render: item => {
            const topology = item.getPreferredCPUTopology();
            return topology !== '-' ? (
              <Chip label={topology} size="small" variant="outlined" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        'age',
      ]}
      data={items}
      reflectInURL
      id="headlamp-virtualmachineclusterpreferences"
    />
  );
}

export default function VirtualMachineClusterPreferenceList() {
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const { items, error } = VirtualMachineClusterPreference.useList({});

  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  return (
    <VirtualMachineClusterPreferenceListRenderer
      items={items}
      error={error}
      reflectTableInURL
    />
  );
}
