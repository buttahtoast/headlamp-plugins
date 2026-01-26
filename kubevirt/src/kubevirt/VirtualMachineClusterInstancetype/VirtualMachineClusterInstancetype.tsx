import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineClusterInstancetype extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  // Get CPU configuration
  getCPU(): { guest: number; model?: string; dedicatedCPUPlacement?: boolean } {
    return {
      guest: this.spec?.cpu?.guest || 0,
      model: this.spec?.cpu?.model,
      dedicatedCPUPlacement: this.spec?.cpu?.dedicatedCPUPlacement,
    };
  }

  // Get memory configuration
  getMemory(): { guest: string; hugepages?: { pageSize: string } } {
    return {
      guest: this.spec?.memory?.guest || '0',
      hugepages: this.spec?.memory?.hugepages,
    };
  }

  // Get GPU devices
  getGPUs(): any[] {
    return this.spec?.gpus || [];
  }

  // Get host devices
  getHostDevices(): any[] {
    return this.spec?.hostDevices || [];
  }

  // Get IO threads policy
  getIOThreadsPolicy(): string {
    return this.spec?.ioThreadsPolicy || '-';
  }

  // Get launch security configuration
  getLaunchSecurity(): any {
    return this.spec?.launchSecurity;
  }

  // Check if has dedicated CPU
  hasDedicatedCPU(): boolean {
    return this.spec?.cpu?.dedicatedCPUPlacement === true;
  }

  // Check if has hugepages
  hasHugepages(): boolean {
    return !!this.spec?.memory?.hugepages;
  }

  static kind = 'VirtualMachineClusterInstancetype';
  static apiVersion = 'instancetype.kubevirt.io/v1beta1';
  static isNamespaced = false;
  static apiName = 'virtualmachineclusterinstancetypes';
}

export default VirtualMachineClusterInstancetype;
