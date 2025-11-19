import Resource from '@kinvolk/headlamp-plugin/lib/components/common';
import { useParams } from 'react-router-dom';
import { Tenants } from '../resources/tenants';

export interface TenantProps {
  name?: string;
}


export function TenantDetail(props: TenantProps) {
  const params = useParams<{ name: string }>();
  const { name = params.name} = props;
  return (
      <Resource.DetailsGrid
        name={name}
        resourceType={Tenants}
      />
  );
}
