import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { API_ROOT, dashboardPath, DashboardSettings } from './model';

export function dashboardRequest(
  cluster: string,
  settings: DashboardSettings,
  suffix: string,
  method = 'GET'
) {
  return request(dashboardPath(settings, suffix), { cluster, method, timeout: 20000 });
}

export async function allowed(
  cluster: string,
  resource: string,
  verb: string,
  namespace?: string,
  name?: string,
  apiGroup = resource === 'services/proxy' ? '' : 'apps.projectsveltos.io'
) {
  const [resourceName, subresource] = resource.split('/');
  try {
    const response = await request('/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
      cluster,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            group: apiGroup,
            resource: resourceName,
            subresource,
            verb,
            namespace,
            name,
          },
        },
      }),
    });
    return response.status?.allowed === true;
  } catch {
    return false;
  }
}

export function saveCleaner(cluster: string, value: object, name?: string) {
  return request(`${API_ROOT}/cleaners${name ? `/${encodeURIComponent(name)}` : ''}`, {
    cluster,
    method: name ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}
