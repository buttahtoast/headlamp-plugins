import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class DataVolume extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  // Get the source type (http, registry, pvc, upload, blank, etc.)
  getSourceType(): string {
    const source = this.spec?.source;
    if (!source) return 'unknown';

    if (source.http) return 'HTTP';
    if (source.registry) return 'Registry';
    if (source.pvc) return 'PVC Clone';
    if (source.upload) return 'Upload';
    if (source.blank) return 'Blank';
    if (source.s3) return 'S3';
    if (source.gcs) return 'GCS';
    if (source.imageio) return 'ImageIO';
    if (source.vddk) return 'VDDK';
    if (source.snapshot) return 'Snapshot';

    return 'unknown';
  }

  // Get the source URL or reference
  getSourceReference(): string {
    const source = this.spec?.source;
    if (!source) return '-';

    if (source.http?.url) return source.http.url;
    if (source.registry?.url) return source.registry.url;
    if (source.pvc?.name) {
      const ns = source.pvc.namespace || this.getNamespace();
      return `${ns}/${source.pvc.name}`;
    }
    if (source.s3?.url) return source.s3.url;
    if (source.gcs?.url) return source.gcs.url;
    if (source.snapshot?.name) {
      const ns = source.snapshot.namespace || this.getNamespace();
      return `${ns}/${source.snapshot.name}`;
    }

    return '-';
  }

  // Get storage size
  getStorageSize(): string {
    return this.spec?.storage?.resources?.requests?.storage ||
           this.spec?.pvc?.resources?.requests?.storage ||
           '-';
  }

  // Get storage class
  getStorageClass(): string {
    return this.spec?.storage?.storageClassName ||
           this.spec?.pvc?.storageClassName ||
           '-';
  }

  // Get access modes
  getAccessModes(): string[] {
    return this.spec?.storage?.accessModes ||
           this.spec?.pvc?.accessModes ||
           [];
  }

  // Get the phase/status
  getPhase(): string {
    return this.status?.phase || 'Unknown';
  }

  // Get progress percentage
  getProgress(): string {
    return this.status?.progress || '-';
  }

  // Get the associated PVC name
  getPVCName(): string {
    // DataVolume creates a PVC with the same name
    return this.getName();
  }

  static kind = 'DataVolume';
  static apiVersion = 'cdi.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'datavolumes';
}

export default DataVolume;
