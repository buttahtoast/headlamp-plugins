import {
  registerAppBarAction,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { TenantBox } from './components/tenantBox';
import { TenantsList } from './components/tenantList';
import { TenantDetail } from './components/tenantProject';

// Register the wrapper as an app bar action
registerAppBarAction(<TenantBox />);

registerSidebarEntry({
  parent: 'capsule',
  name: 'tenants',
  label: 'Tenants',
  icon: 'mdi:ufo-outline',
  url: '/capsule/tenants/',
});

registerSidebarEntry({
  parent: '',
  name: 'capsule',
  label: 'Capsule',
  icon: 'mdi:ufo-outline',
  url: '/capsule/tenants/',
});

registerRoute({
  path: '/capsule/tenants/',
  parent: 'cluster',
  sidebar: 'tenants',
  name: 'tenants',
  component: () => <TenantsList />,
  exact: true,
});

registerRoute({
  path: '/capsule/tenants/:name',
  sidebar: 'tenants',
  name: 'tenant',
  component: () => {
    return <TenantDetail />;
  },
  exact: true,
  params: ['name'],
});
