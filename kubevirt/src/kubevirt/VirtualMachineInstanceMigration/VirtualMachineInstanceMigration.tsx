import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineInstanceMigration extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  // Get the VMI name being migrated
  getVMIName(): string {
    return this.spec?.vmiName || '-';
  }

  // Get the migration phase
  getPhase(): string {
    return this.status?.phase || 'Unknown';
  }

  // Get source node
  getSourceNode(): string {
    return this.status?.migrationState?.sourceNode || '-';
  }

  // Get target node
  getTargetNode(): string {
    return this.status?.migrationState?.targetNode || '-';
  }

  // Get target pod name
  getTargetPod(): string {
    return this.status?.migrationState?.targetPod || '-';
  }

  // Check if migration is completed
  isCompleted(): boolean {
    return this.status?.phase === 'Succeeded';
  }

  // Check if migration failed
  isFailed(): boolean {
    return this.status?.phase === 'Failed';
  }

  // Get start timestamp
  getStartTimestamp(): string {
    return this.status?.migrationState?.startTimestamp || '';
  }

  // Get end timestamp
  getEndTimestamp(): string {
    return this.status?.migrationState?.endTimestamp || '';
  }

  // Get migration mode (PreCopy, PostCopy)
  getMigrationMode(): string {
    return this.status?.migrationState?.mode || '-';
  }

  static kind = 'VirtualMachineInstanceMigration';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachineinstancemigrations';
}

export default VirtualMachineInstanceMigration;
