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
import { useMemo } from 'react';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';
import VirtualMachine from './VirtualMachine';

export interface VirtualMachineListProps {
  virtualMachine: VirtualMachine[] | null;
  vmiMap: Map<string, VirtualMachineInstance>;
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

// Helper to get ready status
function getReadyStatus(vm: VirtualMachine, vmi: VirtualMachineInstance | undefined): string {
  // Check VM conditions first
  const vmConditions = vm.status?.conditions || [];
  const vmReady = vmConditions.find((c: any) => c.type === 'Ready');
  if (vmReady) {
    return vmReady.status === 'True' ? 'True' : 'False';
  }

  // Fallback to VMI conditions
  if (vmi?.status?.conditions) {
    const vmiReady = vmi.status.conditions.find((c: any) => c.type === 'Ready');
    if (vmiReady) {
      return vmiReady.status === 'True' ? 'True' : 'False';
    }
  }

  return vm.status?.printableStatus === 'Running' ? 'True' : 'False';
}

function getStatusColor(status: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'Running':
      return 'success';
    case 'Failed':
    case 'CrashLoopBackOff':
    case 'ErrorUnschedulable':
    case 'ErrImagePull':
    case 'ImagePullBackOff':
    case 'DataVolumeError':
      return 'error';
    case 'Migrating':
    case 'Starting':
    case 'Stopping':
    case 'Paused':
    case 'Scheduling':
    case 'Provisioning':
    case 'WaitingForVolumeBinding':
      return 'warning';
    case 'Stopped':
      return 'info';
    default:
      return 'default';
  }
}

// Helper to get OS info from VMI status (guest agent)
function getOSInfo(vmi: VirtualMachineInstance | undefined): { name: string; version: string; full: string } {
  const guestOS = vmi?.status?.guestOSInfo;
  if (!guestOS) {
    return { name: '', version: '', full: '' };
  }

  const name = guestOS.prettyName || guestOS.name || guestOS.id || '';
  const version = guestOS.version || guestOS.versionId || '';
  const full = name + (version ? ` ${version}` : '');

  return { name, version, full };
}

export function VirtualMachineListRenderer(props: VirtualMachineListProps) {
  const { virtualMachine, vmiMap, error, hideColumns = [], noNamespaceFilter } = props;

  return (
    <Resource.ResourceListView
        title={'Virtual Machines'}
        headerProps={{
          noNamespaceFilter,
        }}
        hideColumns={hideColumns}
        errorMessage={error?.message || (error ? String(error) : '')}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: vm => vm.getName(),
            render: vm => (
              <Link
                routeName="virtualmachine"
                params={{ name: vm.getName(), namespace: vm.getNamespace() }}
              >
                {vm.getName()}
              </Link>
            ),
          },
          'namespace',
          'cluster',
          {
            id: 'ready',
            label: 'Ready',
            show: false, // Hidden by default, can be enabled via column selector
            getValue: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
              return getReadyStatus(vm, vmi);
            },
            render: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
              const ready = getReadyStatus(vm, vmi);
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
            getValue: vm => vm.status?.printableStatus || 'Unknown',
            render: vm => {
              const status = vm.status?.printableStatus || 'Unknown';
              return (
                <Chip
                  label={status}
                  size="small"
                  color={getStatusColor(status)}
                  variant="outlined"
                />
              );
            },
          },
          {
            id: 'ip',
            label: 'IP',
            getValue: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
              return getPrimaryIP(vmi);
            },
            render: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
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
            getValue: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
              return vmi?.status?.nodeName || '';
            },
            render: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
              const nodeName = vmi?.status?.nodeName;
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
            getValue: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
              return getOSInfo(vmi).full;
            },
            render: vm => {
              const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
              const vmi = vmiMap.get(vmiKey);
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
            getValue: vm => {
              const domain = vm.jsonData?.spec?.template?.spec?.domain;
              const cores = domain?.cpu?.cores || 1;
              const sockets = domain?.cpu?.sockets || 1;
              const threads = domain?.cpu?.threads || 1;
              return cores * sockets * threads;
            },
            render: vm => {
              const domain = vm.jsonData?.spec?.template?.spec?.domain;
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
            getValue: vm => {
              const domain = vm.jsonData?.spec?.template?.spec?.domain;
              return domain?.resources?.requests?.memory ||
                     domain?.memory?.guest ||
                     '';
            },
            render: vm => {
              const domain = vm.jsonData?.spec?.template?.spec?.domain;
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
            render: vm => {
              const status = vm.status?.printableStatus || 'Unknown';
              const isRunning = status === 'Running';
              const isStopped = status === 'Stopped';
              return (
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {isStopped && (
                    <ActionButton
                      description="Start VM"
                      icon="mdi:play"
                      onClick={() => vm.start()}
                    />
                  )}
                  {isRunning && (
                    <>
                      <ActionButton
                        description="Stop VM"
                        icon="mdi:stop"
                        onClick={() => vm.stop()}
                      />
                      <ActionButton
                        description="Restart VM"
                        icon="mdi:restart"
                        onClick={() => vm.restart()}
                      />
                      <ActionButton
                        description="Pause VM"
                        icon="mdi:pause"
                        onClick={() => vm.pause()}
                      />
                    </>
                  )}
                  {status === 'Paused' && (
                    <ActionButton
                      description="Unpause VM"
                      icon="mdi:play"
                      onClick={() => vm.unpause()}
                    />
                  )}
                </Box>
              );
            },
          },
          'age',
        ]}
        data={virtualMachine}
        reflectInURL
        id="headlamp-virtualmachines"
      />
  );
}

export default function VirtualMachineList() {
  const { items: vms, error: vmError } = VirtualMachine.useList({});
  const { items: vmis, error: vmiError } = VirtualMachineInstance.useList({});

  // Create a map of VMIs by namespace/name for quick lookup
  const vmiMap = useMemo(() => {
    const map = new Map<string, VirtualMachineInstance>();
    if (vmis) {
      for (const vmi of vmis) {
        const key = `${vmi.getNamespace()}/${vmi.getName()}`;
        map.set(key, vmi);
      }
    }
    return map;
  }, [vmis]);

  return (
    <VirtualMachineListRenderer
      virtualMachine={vms}
      vmiMap={vmiMap}
      error={vmError || vmiError}
      reflectTableInURL
      noNamespaceFilter={false}
    />
  );
}
