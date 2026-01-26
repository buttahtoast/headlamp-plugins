import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  SimpleTableProps,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { ActionButton, Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import {
  Box,
  Chip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import VirtualMachineSnapshot from './VirtualMachineSnapshot';

export interface VirtualMachineSnapshotListProps {
  items: VirtualMachineSnapshot[] | null;
  error: ApiError | null;
  hideColumns?: ['namespace'];
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
  noNamespaceFilter?: boolean;
}

function getPhaseColor(phase: string, isReady: boolean): 'success' | 'error' | 'warning' | 'info' | 'default' {
  if (isReady) return 'success';
  switch (phase) {
    case 'Succeeded':
      return 'success';
    case 'Failed':
      return 'error';
    case 'InProgress':
      return 'warning';
    default:
      return 'default';
  }
}

export function VirtualMachineSnapshotListRenderer(props: VirtualMachineSnapshotListProps) {
  const { items, error, hideColumns = [], noNamespaceFilter } = props;
  const { enqueueSnackbar } = useSnackbar();

  const handleRestore = async (snapshot: VirtualMachineSnapshot) => {
    try {
      const restore = {
        apiVersion: 'snapshot.kubevirt.io/v1beta1',
        kind: 'VirtualMachineRestore',
        metadata: {
          name: `restore-${snapshot.getName()}-${Date.now()}`,
          namespace: snapshot.getNamespace(),
        },
        spec: {
          target: {
            apiGroup: 'kubevirt.io',
            kind: 'VirtualMachine',
            name: snapshot.getSourceVMName(),
          },
          virtualMachineSnapshotName: snapshot.getName(),
        },
      };

      await ApiProxy.request(
        `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${snapshot.getNamespace()}/virtualmachinerestores`,
        {
          method: 'POST',
          body: JSON.stringify(restore),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar('Restore initiated successfully', { variant: 'success' });
    } catch (err: any) {
      enqueueSnackbar(`Failed to restore: ${err.message}`, { variant: 'error' });
    }
  };

  return (
    <Resource.ResourceListView
      title={'Virtual Machine Snapshots'}
      headerProps={{
        noNamespaceFilter,
      }}
      hideColumns={hideColumns}
      errorMessage={error?.message || (error ? String(error) : '')}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: snapshot => snapshot.getName(),
          render: snapshot => (
            <Link
              routeName="virtualmachinesnapshot"
              params={{ name: snapshot.getName(), namespace: snapshot.getNamespace() }}
            >
              {snapshot.getName()}
            </Link>
          ),
        },
        'namespace',
        'cluster',
        {
          id: 'vm',
          label: 'Source VM',
          getValue: snapshot => snapshot.getSourceVMName(),
          render: snapshot => {
            const vmName = snapshot.getSourceVMName();
            return vmName !== '-' ? (
              <Link
                routeName="virtualmachine"
                params={{ name: vmName, namespace: snapshot.getNamespace() }}
              >
                {vmName}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'status',
          label: 'Status',
          getValue: snapshot => snapshot.getPhase(),
          render: snapshot => {
            const phase = snapshot.getPhase();
            const isReady = snapshot.isReady();
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label={isReady ? 'Ready' : phase}
                  size="small"
                  color={getPhaseColor(phase, isReady)}
                  variant="outlined"
                />
              </Box>
            );
          },
        },
        {
          id: 'indications',
          label: 'Indications',
          getValue: snapshot => snapshot.getIndications().join(', '),
          render: snapshot => {
            const indications = snapshot.getIndications();
            if (indications.length === 0) {
              return <Typography variant="caption" color="text.secondary">-</Typography>;
            }
            return (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {indications.slice(0, 2).map((ind, idx) => (
                  <Chip key={idx} label={ind} size="small" variant="outlined" color="warning" />
                ))}
                {indications.length > 2 && (
                  <Chip label={`+${indications.length - 2}`} size="small" variant="outlined" />
                )}
              </Box>
            );
          },
        },
        {
          id: 'actions',
          label: 'Actions',
          getValue: () => '',
          render: snapshot => (
            <ActionButton
              description="Restore"
              icon="mdi:restore"
              onClick={() => handleRestore(snapshot)}
            />
          ),
        },
        'age',
      ]}
      data={items}
      reflectInURL
      id="headlamp-virtualmachinesnapshots"
    />
  );
}

export default function VirtualMachineSnapshotList() {
  const { items, error } = VirtualMachineSnapshot.useList({});

  return (
    <VirtualMachineSnapshotListRenderer
      items={items}
      error={error}
      reflectTableInURL
      noNamespaceFilter={false}
    />
  );
}
