import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineClusterPreference extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  // Get preferred CPU topology
  getPreferredCPUTopology(): string {
    return this.spec?.cpu?.preferredCPUTopology || '-';
  }

  // Get preferred machine type
  getPreferredMachineType(): string {
    return this.spec?.machine?.preferredMachineType || '-';
  }

  // Get preferred firmware configuration
  getFirmware(): any {
    return this.spec?.firmware;
  }

  // Get preferred features
  getFeatures(): any {
    return this.spec?.features;
  }

  // Get clock preferences
  getClock(): any {
    return this.spec?.clock;
  }

  // Get device preferences
  getDevices(): any {
    return this.spec?.devices;
  }

  // Get preferred disk bus
  getPreferredDiskBus(): string {
    return this.spec?.devices?.preferredDiskBus || '-';
  }

  // Get preferred interface model
  getPreferredInterfaceModel(): string {
    return this.spec?.devices?.preferredInterfaceModel || '-';
  }

  // Check if UEFI is preferred
  prefersUEFI(): boolean {
    return this.spec?.firmware?.preferredUseEfi === true;
  }

  // Check if secure boot is preferred
  prefersSecureBoot(): boolean {
    return this.spec?.firmware?.preferredUseSecureBoot === true;
  }

  static kind = 'VirtualMachineClusterPreference';
  static apiVersion = 'instancetype.kubevirt.io/v1beta1';
  static isNamespaced = false;
  static apiName = 'virtualmachineclusterpreferences';
}

export default VirtualMachineClusterPreference;
