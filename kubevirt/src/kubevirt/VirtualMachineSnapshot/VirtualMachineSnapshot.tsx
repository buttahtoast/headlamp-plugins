import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineSnapshot extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  // Get the source VM name
  getSourceVMName(): string {
    return this.spec?.source?.name || '-';
  }

  // Get the phase/status
  getPhase(): string {
    return this.status?.phase || 'Unknown';
  }

  // Check if snapshot is ready to use
  isReady(): boolean {
    return this.status?.readyToUse === true;
  }

  // Get creation time
  getSnapshotCreationTime(): string {
    return this.status?.creationTime || '';
  }

  // Get error message if any
  getError(): string | null {
    return this.status?.error?.message || null;
  }

  // Get snapshot content name
  getSnapshotContentName(): string {
    return this.status?.virtualMachineSnapshotContentName || '-';
  }

  // Get indications (warnings/info about the snapshot)
  getIndications(): string[] {
    return this.status?.indications || [];
  }

  static kind = 'VirtualMachineSnapshot';
  static apiVersion = 'snapshot.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'virtualmachinesnapshots';
}

export default VirtualMachineSnapshot;
