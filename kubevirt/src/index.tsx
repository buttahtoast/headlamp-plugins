import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import VirtualMachineInstanceDetail from './kubevirt/VirtualMachineInstance/Details';
import VirtualMachineInstanceList from './kubevirt/VirtualMachineInstance/List';
import VirtualMachineDetail from './kubevirt/VirtualMachines/Details';
import PodList from './kubevirt/VirtualMachines/List';

registerSidebarEntry({
  parent: null,
  name: 'kubevirt',
  label: 'Kubevirt',
  icon: 'eos-icons:virtual-guest',
  url: '/kubevirt/virtualmachines/',
});

registerSidebarEntry({
  parent: 'kubevirt',
  name: 'virtualmachines',
  label: 'Virtual Machines',
  icon: 'codicon:vm',
  url: '/kubevirt/virtualmachines/',
});

registerRoute({
  path: '/kubevirt/virtualmachines/',
  parent: 'kubevirt',
  sidebar: 'virtualmachines',
  component: () => <PodList />,
  exact: true,
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

registerRoute({
  path: '/kubevirt/virtualmachineinstances/',
  parent: 'kubevirt',
  sidebar: 'virtualmachineinstances',
  component: () => <VirtualMachineInstanceList />,
  exact: true,
});

registerRoute({
  path: '/kubevirt/virtualmachinesinstances/:namespace/:name',
  parent: 'kubevirt',
  sidebar: 'virtualmachineinstances',
  component: () => <VirtualMachineInstanceDetail />,
  exact: true,
  name: 'virtualmachineinstance',
  params: ['namespace', 'name'],
});
