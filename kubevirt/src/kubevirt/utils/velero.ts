import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

export interface VeleroBackup {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
    uid?: string;
  };
  spec: {
    includedNamespaces?: string[];
    excludedNamespaces?: string[];
    includedResources?: string[];
    excludedResources?: string[];
    labelSelector?: {
      matchLabels?: Record<string, string>;
    };
    orLabelSelectors?: Array<{ matchLabels?: Record<string, string> }>;
    storageLocation?: string;
    volumeSnapshotLocations?: string[];
    ttl?: string;
    snapshotVolumes?: boolean;
    snapshotMoveData?: boolean;
    defaultVolumesToFsBackup?: boolean;
    hooks?: any;
    resourcePolicies?: {
      kind: string;
      name: string;
    };
    itemOperationTimeout?: string;
  };
  status?: {
    phase: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    expiration?: string;
    errors?: number;
    warnings?: number;
    progress?: {
      itemsBackedUp?: number;
      totalItems?: number;
    };
    volumeSnapshotsAttempted?: number;
    volumeSnapshotsCompleted?: number;
    failureReason?: string;
    validationErrors?: string[];
  };
}

export interface VeleroRestore {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  spec: {
    backupName: string;
    includedNamespaces?: string[];
    excludedNamespaces?: string[];
    includedResources?: string[];
    excludedResources?: string[];
    namespaceMapping?: Record<string, string>;
    labelSelector?: {
      matchLabels?: Record<string, string>;
    };
    parallelFilesDownload?: number;
    itemOperationTimeout?: string;
  };
  status?: {
    phase: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    errors?: number;
    warnings?: number;
    failureReason?: string;
  };
}

/**
 * Extract VM name from a Velero backup's labels or label selector
 */
export function getVMNameFromBackup(backup: VeleroBackup | any): string | undefined {
  return backup?.metadata?.labels?.['kubevirt.io/vm'] ||
         backup?.spec?.labelSelector?.matchLabels?.['kubevirt.io/vm'] ||
         backup?.spec?.labelSelector?.matchLabels?.['vm.kubevirt.io/name'] ||
         backup?.spec?.orLabelSelectors?.[0]?.matchLabels?.['vm.kubevirt.io/name'];
}

/**
 * Get the source namespace from a backup
 */
export function getBackupNamespace(backup: VeleroBackup | any): string {
  return backup?.metadata?.labels?.['kubevirt.io/vm-namespace'] ||
         backup?.spec?.includedNamespaces?.[0] ||
         '';
}

/**
 * Check if a backup is applicable to a specific VM
 * A backup is applicable if:
 * 1. It explicitly targets this VM via labels or label selectors
 * 2. It includes the VM's namespace without a specific VM filter (backs up all in namespace)
 */
export function isBackupApplicableToVM(backup: VeleroBackup | any, vmName: string, namespace: string): boolean {
  if (!backup) return false;

  // Check metadata labels
  const backupVMLabel = backup.metadata?.labels?.['kubevirt.io/vm'];
  const backupVMNamespace = backup.metadata?.labels?.['kubevirt.io/vm-namespace'];

  // If backup has explicit VM label, it must match
  if (backupVMLabel) {
    return backupVMLabel === vmName && (!backupVMNamespace || backupVMNamespace === namespace);
  }

  // Check if backup includes the namespace
  const includedNamespaces = backup.spec?.includedNamespaces || [];
  const includesNamespace = includedNamespaces.length === 0 || includedNamespaces.includes(namespace);

  if (!includesNamespace) {
    return false;
  }

  // Check label selector
  const labelSelector = backup.spec?.labelSelector?.matchLabels;
  if (labelSelector) {
    // Check for kubevirt.io/vm label
    if (labelSelector['kubevirt.io/vm']) {
      return labelSelector['kubevirt.io/vm'] === vmName;
    }
    // Check for vm.kubevirt.io/name label
    if (labelSelector['vm.kubevirt.io/name']) {
      return labelSelector['vm.kubevirt.io/name'] === vmName;
    }
  }

  // Check orLabelSelectors
  const orLabelSelectors = backup.spec?.orLabelSelectors || [];
  for (const selector of orLabelSelectors) {
    const matchLabels = selector.matchLabels || {};
    if (matchLabels['kubevirt.io/vm'] === vmName || matchLabels['vm.kubevirt.io/name'] === vmName) {
      return true;
    }
  }

  // If backup includes namespace but has no VM-specific selector,
  // it backs up all resources in the namespace (including this VM)
  if (includesNamespace && !labelSelector && orLabelSelectors.length === 0) {
    return true;
  }

  return false;
}

/**
 * Filter backups that are applicable to a specific VM
 */
export function filterBackupsForVM(backups: (VeleroBackup | any)[], vmName: string, namespace: string): VeleroBackup[] {
  return backups.filter(b => isBackupApplicableToVM(b, vmName, namespace));
}

export interface CreateRestoreOptions {
  /** The backup to restore from */
  backup: VeleroBackup | any;
  /** Override the VM name (useful when restoring from VM/VMI details page) */
  vmName?: string;
  /** Target namespace to restore to (if different from source) */
  targetNamespace?: string;
  /** Custom restore name (auto-generated if not provided) */
  restoreName?: string;
}

/**
 * Create a Velero Restore spec for a KubeVirt VM backup
 * This includes all the necessary options for proper disk restoration:
 * - includedResources: ['*'] - include all resources
 * - labelSelector - filter by VM label
 * - parallelFilesDownload: 8 - parallel downloads for faster restore
 * - itemOperationTimeout: '10h' - long timeout for data operations
 */
export function createRestoreSpec(options: CreateRestoreOptions): VeleroRestore {
  const { backup, vmName, targetNamespace, restoreName } = options;

  const backupName = backup?.metadata?.name || backup?.backupName || '';
  const generatedName = restoreName || `${backupName}-restore-${Date.now()}`;

  // Get VM name from backup or use provided override
  const resolvedVMName = vmName || getVMNameFromBackup(backup);

  // Get source namespace from backup
  const sourceNamespace = getBackupNamespace(backup);

  const restore: VeleroRestore = {
    apiVersion: 'velero.io/v1',
    kind: 'Restore',
    metadata: {
      name: generatedName,
      namespace: 'velero',
    },
    spec: {
      backupName: backupName,
      includedResources: ['*'],
      itemOperationTimeout: '10h',
      parallelFilesDownload: 8,
    },
  };

  // Add label selector if VM name is available
  if (resolvedVMName) {
    restore.spec.labelSelector = {
      matchLabels: {
        'kubevirt.io/vm': resolvedVMName,
      },
    };
  }

  // Add namespace mapping if restoring to a different namespace
  if (targetNamespace && sourceNamespace) {
    restore.spec.namespaceMapping = {
      [sourceNamespace]: targetNamespace,
    };
  }

  return restore;
}

/**
 * Create and submit a Velero Restore for a KubeVirt VM backup
 */
export async function createRestore(options: CreateRestoreOptions): Promise<VeleroRestore> {
  const restore = createRestoreSpec(options);

  const response = await ApiProxy.request('/apis/velero.io/v1/namespaces/velero/restores', {
    method: 'POST',
    body: JSON.stringify(restore),
    headers: { 'Content-Type': 'application/json' },
  });

  return response as VeleroRestore;
}

/**
 * Get status color for Velero backup/restore phase
 */
export function getVeleroStatusColor(phase: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (phase) {
    case 'Completed': return 'success';
    case 'Failed': return 'error';
    case 'FailedValidation': return 'error';
    case 'InProgress': return 'warning';
    case 'PartiallyFailed': return 'warning';
    case 'New': return 'info';
    default: return 'default';
  }
}

/**
 * Format a date string for display
 */
export function formatVeleroDateTime(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format duration between two timestamps
 */
export function formatVeleroDuration(start?: string, end?: string): string {
  if (!start) return '-';
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffHour > 0) return `${diffHour}h ${diffMin % 60}m`;
  if (diffMin > 0) return `${diffMin}m ${diffSec % 60}s`;
  return `${diffSec}s`;
}
