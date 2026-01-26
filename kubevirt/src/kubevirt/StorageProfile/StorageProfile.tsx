import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class StorageProfile extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  // Get provisioner
  getProvisioner(): string {
    return this.status?.provisioner || '-';
  }

  // Get storage class name
  getStorageClass(): string {
    return this.status?.storageClass || this.getName();
  }

  // Get clone strategy
  getCloneStrategy(): string {
    return this.status?.cloneStrategy || this.spec?.cloneStrategy || '-';
  }

  // Get data import cron source format
  getDataImportCronSourceFormat(): string {
    return this.status?.dataImportCronSourceFormat || '-';
  }

  // Get claim property sets
  getClaimPropertySets(): any[] {
    return this.status?.claimPropertySets || this.spec?.claimPropertySets || [];
  }

  // Get snapshot class
  getSnapshotClass(): string {
    return this.status?.snapshotClass || '-';
  }

  // Check if supports volume snapshots
  supportsVolumeSnapshots(): boolean {
    return !!this.status?.snapshotClass;
  }

  // Check if supports clone
  supportsClone(): boolean {
    return this.status?.cloneStrategy !== undefined && this.status?.cloneStrategy !== '';
  }

  static kind = 'StorageProfile';
  static apiVersion = 'cdi.kubevirt.io/v1beta1';
  static isNamespaced = false;
  static apiName = 'storageprofiles';
}

export default StorageProfile;
