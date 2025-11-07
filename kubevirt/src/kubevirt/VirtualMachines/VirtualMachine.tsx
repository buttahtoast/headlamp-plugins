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

  async start() {
    this.spec.runStrategy = 'Always';
    return this.update(this.jsonData);
  }

  async stop() {
    this.spec.runStrategy = 'Halted';
    return this.update(this.jsonData);
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
    const instance = new VirtualMachineInstance(this.jsonData);
    return instance.exec(onExec, options);
  }

  async pause() {
    const instance = new VirtualMachineInstance(this.jsonData);
    return instance.pause();
  }

  async unpause() {
    const instance = new VirtualMachineInstance(this.jsonData);
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

  static kind = 'VirtualMachine';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachines';
}

export default VirtualMachine;
