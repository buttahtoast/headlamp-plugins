import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { Collection, collections } from './model';
import { CertManagerPage } from './ui';

registerSidebarEntry({
  parent: null,
  name: 'cert-manager',
  label: 'Certificates',
  icon: 'mdi:certificate-outline',
  url: '/cert-manager/overview',
});
registerSidebarEntry({
  parent: 'cert-manager',
  name: 'cert-manager-overview',
  label: 'Overview',
  icon: 'mdi:view-dashboard-outline',
  url: '/cert-manager/overview',
});
registerRoute({
  path: '/cert-manager/overview',
  name: 'cert-manager-overview',
  sidebar: 'cert-manager-overview',
  exact: true,
  component: () => <CertManagerPage />,
});
for (const id of Object.keys(collections) as Collection[]) {
  const descriptor = collections[id];
  registerSidebarEntry({
    parent: 'cert-manager',
    name: `cert-manager-${id}`,
    label: descriptor.label,
    icon: descriptor.icon,
    url: `/cert-manager/${id}`,
  });
  registerRoute({
    path: `/cert-manager/${id}`,
    name: `cert-manager-${id}`,
    sidebar: `cert-manager-${id}`,
    exact: true,
    component: () => <CertManagerPage collection={id} />,
  });
  registerRoute({
    path: `/cert-manager/${id}/${descriptor.namespaced ? ':namespace/:name' : ':name'}`,
    name: `cert-manager-${id}-detail`,
    sidebar: `cert-manager-${id}`,
    exact: true,
    component: () => <CertManagerPage collection={id} detail />,
  });
}
