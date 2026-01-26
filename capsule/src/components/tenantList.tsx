import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Tenants } from '../resources/tenants';
export function TenantsList() {
  return (
    <ResourceListView
      title="Tenants"
      resourceClass={Tenants}
      columns={[
        {
          id: 'name',
          label: 'Name',
          render: item => (
            <Link routeName="/capsule/tenants/:name" params={{ name: item.getName() }}>
              {item.getName()}
            </Link>
          ),
          getValue: item => item.getName(),
        },
        {
          id: 'state',
          label: 'State',
          getValue: item => (item.status?.state ? item.status.state : 'Unknown'),
        },
      ]}
    ></ResourceListView>
  );
}
