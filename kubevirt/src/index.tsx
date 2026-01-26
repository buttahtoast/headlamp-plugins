import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
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
import VirtualMachineInstanceDetail from './kubevirt/VirtualMachineInstance/Details';
import VirtualMachineInstanceList from './kubevirt/VirtualMachineInstance/List';
import VirtualMachineInstanceMigrationDetail from './kubevirt/VirtualMachineInstanceMigration/Details';
import VirtualMachineInstanceMigrationList from './kubevirt/VirtualMachineInstanceMigration/List';
import VirtualMachineDetail from './kubevirt/VirtualMachines/Details';
import VirtualMachineList from './kubevirt/VirtualMachines/List';
import VirtualMachineSnapshotDetail from './kubevirt/VirtualMachineSnapshot/Details';
import VirtualMachineSnapshotList from './kubevirt/VirtualMachineSnapshot/List';

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

// VM Instances
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'virtualmachineinstances',
  label: 'VM Instances',
  icon: 'mdi:server',
  url: '/kubevirt/virtualmachineinstances/',
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

// Network Attachments
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'networkattachmentdefinitions',
  label: 'Network Attachments',
  icon: 'mdi:lan',
  url: '/kubevirt/networkattachmentdefinitions/',
});

// Templates section
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

// Virtual Machine Instance routes
registerRoute({
  path: '/kubevirt/virtualmachineinstances/',
  parent: 'kubevirt',
  sidebar: 'virtualmachineinstances',
  component: () => <VirtualMachineInstanceList />,
  exact: true,
  name: 'virtualmachineinstances',
});

registerRoute({
  path: '/kubevirt/virtualmachineinstances/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachineinstances',
  component: () => <VirtualMachineInstanceDetail />,
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
