import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

class VirtualMachine extends KubeObject {
  constructor(jsonData) {
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
      const instance = new VirtualMachineInstance(this.jsonData)
      return instance.exec(onExec, options)
      
    }

  static kind = 'VirtualMachine';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachines';
}

// VirtualMachine.kind = 'VirtualMachine';
// VirtualMachine.apiName = 'virtualmachines';
// VirtualMachine.apiVersion = 'kubevirt.io/v1';
// VirtualMachine.isNamespaced = true;

export default VirtualMachine;
