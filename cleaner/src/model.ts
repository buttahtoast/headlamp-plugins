export const API_VERSION = 'apps.projectsveltos.io/v1alpha1';
export const API_ROOT = `/apis/${API_VERSION}`;
export type Action = 'Scan' | 'Delete' | 'Transform';

export interface Selector {
  group: string;
  version: string;
  kind: string;
  namespace?: string;
  namespaceSelector?: string;
  labelFilters?: { key: string; operation: string; value?: string }[];
  evaluate?: string;
  [key: string]: unknown;
}

export interface CleanerSpec {
  schedule: string;
  action?: Action;
  resourcePolicySet: { resourceSelectors: Selector[]; aggregatedSelection?: string };
  transform?: string;
  notifications?: { name: string; type: string; [key: string]: unknown }[];
  rollback?: { storage?: string };
  [key: string]: unknown;
}

export interface ResourceInfo {
  resource?: {
    apiVersion?: string;
    kind?: string;
    name?: string;
    namespace?: string;
    uid?: string;
  };
  message?: string;
  fullResource?: string;
}

export interface ReportSpec {
  action: Action;
  resourceInfo?: ResourceInfo[] | null;
}

export interface DashboardSettings {
  namespace: string;
  service: string;
  port: string;
}

export const defaultSettings: DashboardSettings = {
  namespace: 'k8s-cleaner',
  service: 'k8s-cleaner-web',
  port: '9080',
};

export function effectiveAction(spec: Pick<CleanerSpec, 'action'>): Action {
  // The CRD defaults omitted actions to Delete, never Scan.
  return spec.action || 'Delete';
}

export function hasReporting(spec: CleanerSpec): boolean {
  return !!spec.notifications?.some(notification => notification.type === 'CleanerReport');
}

export function canRollback(spec?: ReportSpec): boolean {
  return !!spec && spec.action !== 'Scan' && !!spec.resourceInfo?.some(info => info.fullResource);
}

export function dashboardPath(settings: DashboardSettings, suffix: string): string {
  const dnsName = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
  if (
    !dnsName.test(settings.namespace) ||
    !dnsName.test(settings.service) ||
    settings.namespace.length > 63 ||
    settings.service.length > 63 ||
    !/^\d+$/.test(settings.port) ||
    Number(settings.port) < 1 ||
    Number(settings.port) > 65535
  ) {
    throw new Error('Enter valid namespace and service names, and a port between 1 and 65535.');
  }
  return `/api/v1/namespaces/${settings.namespace}/services/http:${settings.service}:${settings.port}/proxy/api/v1/${suffix}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export function dashboardConnectionIssue(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const detail = errorMessage(error);
  if (status === 403 || /\bforbidden\b/i.test(detail)) {
    return {
      canConfigure: false,
      message:
        'Cleaner dashboard access is denied. Manual runs require get and create permission on services/proxy for the configured Cleaner service. Reading policies, reports, and restoring snapshots uses your Kubernetes permissions.',
    };
  }
  if (status === 401) {
    return { canConfigure: false, message: 'Sign in again to access the Cleaner dashboard.' };
  }
  return {
    canConfigure: true,
    message: `Manual runs are unavailable. Check the configured dashboard service and whether the dashboard is enabled. ${detail}`,
  };
}

export function validateCleaner(
  value: unknown,
  existingName?: string
): asserts value is {
  apiVersion: string;
  kind: string;
  metadata: { name: string; resourceVersion?: string };
  spec: CleanerSpec;
} {
  const obj = value as {
    apiVersion?: string;
    kind?: string;
    metadata?: { name?: string; namespace?: string };
    spec?: CleanerSpec;
  };
  if (!obj || obj.apiVersion !== API_VERSION || obj.kind !== 'Cleaner') {
    throw new Error(`Use a single Cleaner with apiVersion ${API_VERSION}.`);
  }
  if (!obj.metadata?.name || obj.metadata.namespace)
    throw new Error('A Cleaner needs a name and must be cluster-scoped (no namespace).');
  if (existingName && obj.metadata.name !== existingName)
    throw new Error('The name cannot be changed while editing a Cleaner.');
  if (!obj.spec?.schedule || !obj.spec.resourcePolicySet?.resourceSelectors?.length) {
    throw new Error('A schedule and at least one resource selector are required.');
  }
  if (!['Scan', 'Delete', 'Transform'].includes(obj.spec.action || '')) {
    throw new Error(
      'Set action explicitly to Scan, Delete, or Transform. Scan only reports matches.'
    );
  }
  if (obj.spec.action === 'Transform' && !obj.spec.transform?.trim())
    throw new Error('Transform requires a Lua transform function.');
}

// Headlamp's YAML editor returns an array, even for a single YAML document.
export function cleanerFromEditor(value: unknown, existingName?: string) {
  const item = Array.isArray(value) && value.length === 1 ? value[0] : value;
  validateCleaner(item, existingName);
  return item;
}
