import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { useEffect } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import Dashboard from './kubevirt/Dashboard/Dashboard';
import DataVolumeDetail from './kubevirt/DataVolume/Details';
import DataVolumeList from './kubevirt/DataVolume/List';
import NetworkAttachmentDefinitionDetail from './kubevirt/NetworkAttachmentDefinition/Details';
import NetworkAttachmentDefinitionList from './kubevirt/NetworkAttachmentDefinition/List';
import StorageProfileDetail from './kubevirt/StorageProfile/Details';
import StorageProfileList from './kubevirt/StorageProfile/List';
import VirtualMachineClusterInstancetypeDetail from './kubevirt/VirtualMachineClusterInstancetype/Details';
import VirtualMachineClusterInstancetypeList from './kubevirt/VirtualMachineClusterInstancetype/List';
import VirtualMachineClusterPreferenceDetail from './kubevirt/VirtualMachineClusterPreference/Details';
import VirtualMachineClusterPreferenceList from './kubevirt/VirtualMachineClusterPreference/List';
import VirtualMachineInstanceList from './kubevirt/VirtualMachineInstance/List';
import VirtualMachineInstanceMigrationDetail from './kubevirt/VirtualMachineInstanceMigration/Details';
import VirtualMachineInstanceMigrationList from './kubevirt/VirtualMachineInstanceMigration/List';
import VirtualMachineDetail from './kubevirt/VirtualMachines/Details';
import VirtualMachineList from './kubevirt/VirtualMachines/List';

// Redirect component for VMI details -> VM details
function VMIDetailsRedirect() {
  const history = useHistory();
  const params = useParams<{ namespace: string; name: string }>();
  useEffect(() => {
    history.replace(`/kubevirt/virtualmachines/${params.namespace}/${params.name}`);
  }, [history, params.namespace, params.name]);
  return null;
}
import VirtualMachineSnapshotDetail from './kubevirt/VirtualMachineSnapshot/Details';
import VirtualMachineSnapshotList from './kubevirt/VirtualMachineSnapshot/List';

// New feature imports
import PortForwarding from './kubevirt/PortForwarding/PortForwarding';
import NetworkPolicyList from './kubevirt/NetworkPolicy/NetworkPolicyList';
import NodeMaintenanceList from './kubevirt/NodeMaintenance/NodeMaintenanceList';
import BackupList from './kubevirt/Backup/BackupList';
import BackupDetails from './kubevirt/Backup/BackupDetails';
import ScheduleList from './kubevirt/Backup/ScheduleList';
import ScheduleDetails from './kubevirt/Backup/ScheduleDetails';
import RestoreList from './kubevirt/Backup/RestoreList';
import RestoreDetails from './kubevirt/Backup/RestoreDetails';
import VMMetrics from './kubevirt/Monitoring/VMMetrics';

// Parent sidebar entry
registerSidebarEntry({
  parent: null,
  name: 'kubevirt',
  label: 'Kubevirt',
  icon: 'eos-icons:virtual-guest',
  url: '/kubevirt/dashboard/',
});

// Dashboard
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'kubevirt-dashboard',
  label: 'Dashboard',
  icon: 'mdi:view-dashboard',
  url: '/kubevirt/dashboard/',
});

// Virtual Machines
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'virtualmachines',
  label: 'Virtual Machines',
  icon: 'codicon:vm',
  url: '/kubevirt/virtualmachines/',
});

// Migrations
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'virtualmachineinstancemigrations',
  label: 'Migrations',
  icon: 'mdi:swap-horizontal',
  url: '/kubevirt/virtualmachineinstancemigrations/',
});

// Snapshots
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'virtualmachinesnapshots',
  label: 'Snapshots',
  icon: 'mdi:camera',
  url: '/kubevirt/virtualmachinesnapshots/',
});

// Data Volumes
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'datavolumes',
  label: 'Data Volumes',
  icon: 'mdi:harddisk',
  url: '/kubevirt/datavolumes/',
});

// ============ NETWORK SECTION ============
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'kubevirt-network',
  label: 'Network',
  icon: 'mdi:lan',
  url: '/kubevirt/port-forwarding/',
});

// Port Forwarding
registerSidebarEntry({
  parent: 'kubevirt-network',
  name: 'port-forwarding',
  label: 'Port Forwarding',
  icon: 'mdi:lan-connect',
  url: '/kubevirt/port-forwarding/',
});

// Network Policies
registerSidebarEntry({
  parent: 'kubevirt-network',
  name: 'network-policies',
  label: 'Network Policies',
  icon: 'mdi:shield-network',
  url: '/kubevirt/network-policies/',
});

// Network Attachments (moved under Network)
registerSidebarEntry({
  parent: 'kubevirt-network',
  name: 'networkattachmentdefinitions',
  label: 'Attachments (NADs)',
  icon: 'mdi:ethernet',
  url: '/kubevirt/networkattachmentdefinitions/',
});

// ============ DISASTER RECOVERY SECTION ============
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'kubevirt-dr',
  label: 'Disaster Recovery',
  icon: 'mdi:backup-restore',
  url: '/kubevirt/dr/backups/',
});

// Backup List
registerSidebarEntry({
  parent: 'kubevirt-dr',
  name: 'backup-list',
  label: 'Backups',
  icon: 'mdi:package-variant-closed',
  url: '/kubevirt/dr/backups/',
});

// Backup Schedules
registerSidebarEntry({
  parent: 'kubevirt-dr',
  name: 'backup-schedules',
  label: 'Schedules',
  icon: 'mdi:calendar-clock',
  url: '/kubevirt/dr/schedules/',
});

// Restores
registerSidebarEntry({
  parent: 'kubevirt-dr',
  name: 'backup-restores',
  label: 'Restores',
  icon: 'mdi:restore',
  url: '/kubevirt/dr/restores/',
});

// ============ OPERATIONS SECTION ============
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'kubevirt-operations',
  label: 'Operations',
  icon: 'mdi:cog',
  url: '/kubevirt/node-maintenance/',
});

// Node Maintenance
registerSidebarEntry({
  parent: 'kubevirt-operations',
  name: 'node-maintenance',
  label: 'Node Maintenance',
  icon: 'mdi:wrench',
  url: '/kubevirt/node-maintenance/',
});

// Monitoring
registerSidebarEntry({
  parent: 'kubevirt-operations',
  name: 'monitoring',
  label: 'Monitoring',
  icon: 'mdi:chart-line',
  url: '/kubevirt/monitoring/',
});

// ============ TEMPLATES SECTION ============
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'kubevirt-templates',
  label: 'Templates',
  icon: 'mdi:file-document-outline',
  url: '/kubevirt/instancetypes/',
});

// Instance Types (under Templates)
registerSidebarEntry({
  parent: 'kubevirt-templates',
  name: 'virtualmachineclusterinstancetypes',
  label: 'Instance Types',
  icon: 'mdi:shape',
  url: '/kubevirt/instancetypes/',
});

// Preferences (under Templates)
registerSidebarEntry({
  parent: 'kubevirt-templates',
  name: 'virtualmachineclusterpreferences',
  label: 'Preferences',
  icon: 'mdi:tune',
  url: '/kubevirt/preferences/',
});

// Storage Profiles
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'storageprofiles',
  label: 'Storage Profiles',
  icon: 'mdi:database-cog',
  url: '/kubevirt/storageprofiles/',
});

// ============ ROUTES ============

// Dashboard route
registerRoute({
  path: '/kubevirt/dashboard/',
  parent: 'kubevirt',
  sidebar: 'kubevirt-dashboard',
  component: () => <Dashboard />,
  exact: true,
  name: 'kubevirt-dashboard',
});

// Virtual Machine routes
registerRoute({
  path: '/kubevirt/virtualmachines/',
  parent: 'kubevirt',
  sidebar: 'virtualmachines',
  component: () => <VirtualMachineList />,
  exact: true,
  name: 'virtualmachines',
});

registerRoute({
  path: '/kubevirt/virtualmachines/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachines',
  component: () => <VirtualMachineDetail />,
  exact: true,
  name: 'virtualmachine',
  params: ['namespace', 'name'],
});

// Virtual Machine Instance routes (kept for backwards compatibility, points to VM sidebar)
registerRoute({
  path: '/kubevirt/virtualmachineinstances/',
  parent: 'kubevirt',
  sidebar: 'virtualmachines',
  component: () => <VirtualMachineInstanceList />,
  exact: true,
  name: 'virtualmachineinstances',
});

registerRoute({
  path: '/kubevirt/virtualmachineinstances/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachines',
  component: () => <VMIDetailsRedirect />,
  exact: true,
  name: 'virtualmachineinstance',
  params: ['namespace', 'name'],
});

// Virtual Machine Instance Migration routes
registerRoute({
  path: '/kubevirt/virtualmachineinstancemigrations/',
  parent: 'kubevirt',
  sidebar: 'virtualmachineinstancemigrations',
  component: () => <VirtualMachineInstanceMigrationList />,
  exact: true,
  name: 'virtualmachineinstancemigrations',
});

registerRoute({
  path: '/kubevirt/virtualmachineinstancemigrations/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachineinstancemigrations',
  component: () => <VirtualMachineInstanceMigrationDetail />,
  exact: true,
  name: 'virtualmachineinstancemigration',
  params: ['namespace', 'name'],
});

// Virtual Machine Snapshot routes
registerRoute({
  path: '/kubevirt/virtualmachinesnapshots/',
  parent: 'kubevirt',
  sidebar: 'virtualmachinesnapshots',
  component: () => <VirtualMachineSnapshotList />,
  exact: true,
  name: 'virtualmachinesnapshots',
});

registerRoute({
  path: '/kubevirt/virtualmachinesnapshots/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachinesnapshots',
  component: () => <VirtualMachineSnapshotDetail />,
  exact: true,
  name: 'virtualmachinesnapshot',
  params: ['namespace', 'name'],
});

// Data Volume routes
registerRoute({
  path: '/kubevirt/datavolumes/',
  parent: 'kubevirt',
  sidebar: 'datavolumes',
  component: () => <DataVolumeList />,
  exact: true,
  name: 'datavolumes',
});

registerRoute({
  path: '/kubevirt/datavolumes/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'datavolumes',
  component: () => <DataVolumeDetail />,
  exact: true,
  name: 'datavolume',
  params: ['namespace', 'name'],
});

// ============ NETWORK ROUTES ============

// Port Forwarding route
registerRoute({
  path: '/kubevirt/port-forwarding/',
  parent: 'kubevirt',
  sidebar: 'port-forwarding',
  component: () => <PortForwarding />,
  exact: true,
  name: 'port-forwarding',
});

// Network Policies route
registerRoute({
  path: '/kubevirt/network-policies/',
  parent: 'kubevirt',
  sidebar: 'network-policies',
  component: () => <NetworkPolicyList />,
  exact: true,
  name: 'network-policies',
});

// Network Attachment Definition routes
registerRoute({
  path: '/kubevirt/networkattachmentdefinitions/',
  parent: 'kubevirt',
  sidebar: 'networkattachmentdefinitions',
  component: () => <NetworkAttachmentDefinitionList />,
  exact: true,
  name: 'networkattachmentdefinitions',
});

registerRoute({
  path: '/kubevirt/networkattachmentdefinitions/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'networkattachmentdefinitions',
  component: () => <NetworkAttachmentDefinitionDetail />,
  exact: true,
  name: 'networkattachmentdefinition',
  params: ['namespace', 'name'],
});

// ============ OPERATIONS ROUTES ============

// Node Maintenance route
registerRoute({
  path: '/kubevirt/node-maintenance/',
  parent: 'kubevirt',
  sidebar: 'node-maintenance',
  component: () => <NodeMaintenanceList />,
  exact: true,
  name: 'node-maintenance',
});

// ============ DISASTER RECOVERY ROUTES ============

// Backups list route
registerRoute({
  path: '/kubevirt/dr/backups/',
  parent: 'kubevirt',
  sidebar: 'backup-list',
  component: () => <BackupList />,
  exact: true,
  name: 'backups',
});

// Backup details route
registerRoute({
  path: '/kubevirt/dr/backups/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'backup-list',
  component: () => <BackupDetails />,
  exact: true,
  name: 'backup',
  params: ['namespace', 'name'],
});

// Backup schedules route
registerRoute({
  path: '/kubevirt/dr/schedules/',
  parent: 'kubevirt',
  sidebar: 'backup-schedules',
  component: () => <ScheduleList />,
  exact: true,
  name: 'backup-schedules',
});

// Schedule details route
registerRoute({
  path: '/kubevirt/dr/schedules/:name',
  parent: 'kubevirt',
  sidebar: 'backup-schedules',
  component: () => <ScheduleDetails />,
  exact: true,
  name: 'schedule',
  params: ['name'],
});

// Restores route
registerRoute({
  path: '/kubevirt/dr/restores/',
  parent: 'kubevirt',
  sidebar: 'backup-restores',
  component: () => <RestoreList />,
  exact: true,
  name: 'backup-restores',
});

// Restore details route
registerRoute({
  path: '/kubevirt/dr/restores/:name',
  parent: 'kubevirt',
  sidebar: 'backup-restores',
  component: () => <RestoreDetails />,
  exact: true,
  name: 'restore',
  params: ['name'],
});

// Monitoring route
registerRoute({
  path: '/kubevirt/monitoring/',
  parent: 'kubevirt',
  sidebar: 'monitoring',
  component: () => <VMMetrics />,
  exact: true,
  name: 'monitoring',
});

// ============ TEMPLATES ROUTES ============

// Virtual Machine Cluster Instance Type routes
registerRoute({
  path: '/kubevirt/instancetypes/',
  parent: 'kubevirt',
  sidebar: 'virtualmachineclusterinstancetypes',
  component: () => <VirtualMachineClusterInstancetypeList />,
  exact: true,
  name: 'virtualmachineclusterinstancetypes',
});

registerRoute({
  path: '/kubevirt/instancetypes/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachineclusterinstancetypes',
  component: () => <VirtualMachineClusterInstancetypeDetail />,
  exact: true,
  name: 'virtualmachineclusterinstancetype',
  params: ['name'],
});

// Virtual Machine Cluster Preference routes
registerRoute({
  path: '/kubevirt/preferences/',
  parent: 'kubevirt',
  sidebar: 'virtualmachineclusterpreferences',
  component: () => <VirtualMachineClusterPreferenceList />,
  exact: true,
  name: 'virtualmachineclusterpreferences',
});

registerRoute({
  path: '/kubevirt/preferences/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachineclusterpreferences',
  component: () => <VirtualMachineClusterPreferenceDetail />,
  exact: true,
  name: 'virtualmachineclusterpreference',
  params: ['name'],
});

// Storage Profile routes
registerRoute({
  path: '/kubevirt/storageprofiles/',
  parent: 'kubevirt',
  sidebar: 'storageprofiles',
  component: () => <StorageProfileList />,
  exact: true,
  name: 'storageprofiles',
});

registerRoute({
  path: '/kubevirt/storageprofiles/:name',
  parent: 'kubevirt',
  sidebar: 'storageprofiles',
  component: () => <StorageProfileDetail />,
  exact: true,
  name: 'storageprofile',
  params: ['name'],
});
