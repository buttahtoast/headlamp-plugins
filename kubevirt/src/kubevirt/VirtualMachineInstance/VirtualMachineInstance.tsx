import ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineInstance extends KubeObject {
  constructor(jsonData) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
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
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/console`;
    return ApiProxy.stream(url, onExec, {
      isJson: false,
      additionalProtocols: ['plain.kubevirt.io'],
      ...options,
    });
  }

  async pause() {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/pause`;
    return ApiProxy.request(url, { method: 'PUT', isJSON: false });
  }

  async unpause() {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/unpause`;
    return ApiProxy.request(url, { method: 'PUT', isJSON: false });
  }

  static kind = 'VirtualMachineInstance';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachineinstances';
}

export default VirtualMachineInstance;
