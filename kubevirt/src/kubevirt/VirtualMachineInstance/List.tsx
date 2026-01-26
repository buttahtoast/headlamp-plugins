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
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import VirtualMachineInstance from './VirtualMachineInstance';

export interface VirtualMachineInstanceListProps {
  virtualMachineInstances: VirtualMachineInstance[] | null;
  error: ApiError | null;
  hideColumns?: ['namespace'];
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
  noNamespaceFilter?: boolean;
}

// Helper to get primary IP from VMI interfaces
function getPrimaryIP(vmi: VirtualMachineInstance | undefined): string {
  if (!vmi?.status?.interfaces) return '';

  for (const iface of vmi.status.interfaces) {
    // Prefer IPv4
    if (iface.ipAddresses?.length > 0) {
      const ipv4 = iface.ipAddresses.find((ip: string) => ip && !ip.includes(':'));
      if (ipv4) return ipv4;
    }
    if (iface.ipAddress && !iface.ipAddress.includes(':')) {
      return iface.ipAddress;
    }
  }

  // Fallback to any IP
  for (const iface of vmi.status.interfaces) {
    if (iface.ipAddresses?.length > 0) {
      return iface.ipAddresses[0];
    }
    if (iface.ipAddress) {
      return iface.ipAddress;
    }
  }

  return '';
}

// Helper to get ready status from VMI conditions
function getReadyStatus(vmi: VirtualMachineInstance): string {
  const conditions = vmi.status?.conditions || [];
  const readyCondition = conditions.find((c: any) => c.type === 'Ready');
  if (readyCondition) {
    return readyCondition.status === 'True' ? 'True' : 'False';
  }
  return vmi.status?.phase === 'Running' ? 'True' : 'False';
}

// Helper to get OS info
function getOSInfo(vmi: VirtualMachineInstance): { name: string; full: string } {
  const guestOS = vmi?.status?.guestOSInfo;
  if (!guestOS) {
    return { name: '', full: '' };
  }

  const name = guestOS.prettyName || guestOS.name || guestOS.id || '';
  const version = guestOS.version || guestOS.versionId || '';
  const full = name + (version ? ` ${version}` : '');

  return { name, full };
}

function getPhaseColor(phase: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (phase) {
    case 'Running':
      return 'success';
    case 'Failed':
    case 'Unknown':
      return 'error';
    case 'Pending':
    case 'Scheduling':
    case 'Scheduled':
      return 'warning';
    case 'Succeeded':
      return 'info';
    default:
      return 'default';
  }
}

export function VirtualMachineInstanceListRenderer(props: VirtualMachineInstanceListProps) {
  const { virtualMachineInstances, error, hideColumns = [], noNamespaceFilter } = props;
  const { enqueueSnackbar } = useSnackbar();

  const handleMigrate = async (vmi: VirtualMachineInstance) => {
    try {
      const migrationName = `${vmi.getName()}-migration-${Date.now()}`;
      const migration = {
        apiVersion: 'kubevirt.io/v1',
        kind: 'VirtualMachineInstanceMigration',
        metadata: {
          name: migrationName,
          namespace: vmi.getNamespace(),
        },
        spec: {
          vmiName: vmi.getName(),
        },
      };
      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${vmi.getNamespace()}/virtualmachineinstancemigrations`,
        {
          method: 'POST',
          body: JSON.stringify(migration),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      enqueueSnackbar(`Migration initiated for ${vmi.getName()}`, { variant: 'success' });
    } catch (err: any) {
      enqueueSnackbar(`Failed to migrate: ${err.message}`, { variant: 'error' });
    }
  };

  return (
    <Resource.ResourceListView
      title={'Virtual Machine Instances'}
      headerProps={{
        noNamespaceFilter,
      }}
      hideColumns={hideColumns}
      errorMessage={error?.message || (error ? String(error) : '')}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: vmi => vmi.getName(),
          render: vmi => (
            <Link
              routeName="virtualmachineinstance"
              params={{
                name: vmi.getName(),
                namespace: vmi.getNamespace(),
              }}
            >
              {vmi.getName()}
            </Link>
          ),
        },
        'namespace',
        'cluster',
        {
          id: 'ready',
          label: 'Ready',
          show: false, // Hidden by default
          getValue: vmi => getReadyStatus(vmi),
          render: vmi => {
            const ready = getReadyStatus(vmi);
            return (
              <Chip
                label={ready}
                size="small"
                color={ready === 'True' ? 'success' : 'default'}
                variant="outlined"
              />
            );
          },
        },
        {
          id: 'status',
          label: 'Status',
          getValue: vmi => vmi.status?.phase || 'Unknown',
          render: vmi => {
            const phase = vmi.status?.phase || 'Unknown';
            return (
              <Chip
                label={phase}
                size="small"
                color={getPhaseColor(phase)}
                variant="outlined"
              />
            );
          },
        },
        {
          id: 'ip',
          label: 'IP',
          getValue: vmi => getPrimaryIP(vmi),
          render: vmi => {
            const ip = getPrimaryIP(vmi);
            return ip ? (
              <Chip label={ip} size="small" variant="outlined" color="info" sx={{ fontFamily: 'monospace' }} />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'node',
          label: 'Node',
          getValue: vmi => vmi.status?.nodeName || '',
          render: vmi => {
            const nodeName = vmi.status?.nodeName;
            return nodeName ? (
              <Link routeName="node" params={{ name: nodeName }} tooltip>
                {nodeName}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'os',
          label: 'Operating System',
          getValue: vmi => getOSInfo(vmi).full,
          render: vmi => {
            const osInfo = getOSInfo(vmi);
            if (!osInfo.name) {
              return <Typography variant="caption" color="text.secondary">-</Typography>;
            }
            return (
              <Tooltip title={osInfo.full}>
                <Typography
                  variant="body2"
                  sx={{
                    maxWidth: 250,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {osInfo.name}
                </Typography>
              </Tooltip>
            );
          },
        },
        {
          id: 'cpu',
          label: 'CPU',
          gridTemplate: '0.5fr',
          getValue: vmi => {
            const domain = vmi.spec?.domain;
            const cores = domain?.cpu?.cores || 1;
            const sockets = domain?.cpu?.sockets || 1;
            const threads = domain?.cpu?.threads || 1;
            return cores * sockets * threads;
          },
          render: vmi => {
            const domain = vmi.spec?.domain;
            const cores = domain?.cpu?.cores || 1;
            const sockets = domain?.cpu?.sockets || 1;
            const threads = domain?.cpu?.threads || 1;
            const total = cores * sockets * threads;
            return <Chip label={`${total} vCPU`} size="small" variant="outlined" />;
          },
        },
        {
          id: 'memory',
          label: 'Mem',
          gridTemplate: '0.5fr',
          getValue: vmi => {
            const domain = vmi.spec?.domain;
            return domain?.resources?.requests?.memory ||
                   domain?.memory?.guest ||
                   '';
          },
          render: vmi => {
            const domain = vmi.spec?.domain;
            const mem = domain?.resources?.requests?.memory || domain?.memory?.guest || '';
            return mem ? (
              <Chip label={mem} size="small" variant="outlined" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'actions',
          label: 'Actions',
          getValue: () => '',
          render: vmi => {
            const phase = vmi.status?.phase || 'Unknown';
            const isRunning = phase === 'Running';
            const isPaused = vmi.status?.conditions?.some((c: any) => c.type === 'Paused' && c.status === 'True');
            return (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {isRunning && !isPaused && (
                  <>
                    <ActionButton
                      description="Pause"
                      icon="mdi:pause"
                      onClick={() => vmi.pause()}
                    />
                    <ActionButton
                      description="Migrate"
                      icon="mdi:arrow-left-right"
                      onClick={() => handleMigrate(vmi)}
                    />
                  </>
                )}
                {isPaused && (
                  <ActionButton
                    description="Unpause"
                    icon="mdi:play"
                    onClick={() => vmi.unpause()}
                  />
                )}
              </Box>
            );
          },
        },
        'age',
      ]}
      data={virtualMachineInstances}
      reflectInURL
      id="headlamp-virtualmachineinstances"
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
