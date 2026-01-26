import ApiProxy, { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

class VirtualMachine extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  // Get printable status
  getStatus(): string {
    return this.status?.printableStatus || 'Unknown';
  }

  async start() {
    this.spec.runStrategy = 'Always';
    return this.update(this.jsonData);
  }

  async stop() {
    this.spec.runStrategy = 'Halted';
    return this.update(this.jsonData);
  }

  async restart() {
    // Use KubeVirt's restart subresource API
    await ApiProxy.request(
      `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/restart`,
      {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  getLastStateChangeTimestamp() {
    return new Date(
      this.status?.conditions?.find(c => c.type === 'Ready')?.lastTransitionTime || 0
    );
  }

  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    // Build VMI-compatible data using VM's metadata
    const vmiData = {
      ...this.jsonData,
      kind: VirtualMachineInstance.kind,
      apiVersion: VirtualMachineInstance.apiVersion,
    };
    const instance = new VirtualMachineInstance(vmiData);
    return instance.exec(onExec, options);
  }

  async pause() {
    const vmiData = {
      ...this.jsonData,
      kind: VirtualMachineInstance.kind,
      apiVersion: VirtualMachineInstance.apiVersion,
    };
    const instance = new VirtualMachineInstance(vmiData);
    return instance.pause();
  }

  async unpause() {
    const vmiData = {
      ...this.jsonData,
      kind: VirtualMachineInstance.kind,
      apiVersion: VirtualMachineInstance.apiVersion,
    };
    const instance = new VirtualMachineInstance(vmiData);
    return instance.unpause();
  }

  async migrate() {
    const migrationName = `${this.getName()}-migration-${Date.now()}`;
    const migration = {
      apiVersion: 'kubevirt.io/v1',
      kind: 'VirtualMachineInstanceMigration',
      metadata: {
        name: migrationName,
        namespace: this.getNamespace(),
      },
      spec: {
        vmiName: this.getName(),
      },
    };

    await ApiProxy.request(
      `/apis/kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstancemigrations`,
      {
        method: 'POST',
        body: JSON.stringify(migration),
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    return migrationName;
  }

  getVncUrl(): string {
    const vmiData = {
      ...this.jsonData,
      kind: VirtualMachineInstance.kind,
      apiVersion: VirtualMachineInstance.apiVersion,
    };
    const instance = new VirtualMachineInstance(vmiData);
    // Copy over the cluster name from the parent VM
    (instance as any)._clusterName = (this as any)._clusterName;
    return instance.getVncUrl();
  }

  vnc(
    onVnc: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const vmiData = {
      ...this.jsonData,
      kind: VirtualMachineInstance.kind,
      apiVersion: VirtualMachineInstance.apiVersion,
    };
    const instance = new VirtualMachineInstance(vmiData);
    return instance.vnc(onVnc, options);
  }

  static kind = 'VirtualMachine';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachines';
}

export default VirtualMachine;
