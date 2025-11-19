import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Tenants } from '../resources/tenants';
export function TenantsList() {
  return (
    <ResourceListView
      title="Tenants"
      resourceClass={Tenants}
      columns={[
        'name',
        'namespace',
        {
          id: 'ready',
          label: 'Ready',
          render: item => (
            <Link routeName="/capsule/tenants/:name" params={{ name: item.getName() }}>
              {item.getName()}
            </Link>
          ),
          getValue: item => (item.status.state ? 'Active' : 'Not Active'),
        },
      ]}
    ></ResourceListView>
  );
}
