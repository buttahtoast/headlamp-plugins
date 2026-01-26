import ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineInstance extends KubeObject {
  constructor(jsonData: any) {
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
      this.status?.conditions?.find((c: { type: string; }) => c.type === 'Ready')?.lastTransitionTime || 0
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

  getVncUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:4466';
    // Try to get cluster from the object's internal cluster name first
    const cluster = (this as any)._clusterName || null;
    const clusterPrefix = cluster ? `/clusters/${cluster}` : '';

    console.log('VNC URL - host:', host, 'cluster:', cluster, 'protocol:', protocol);
    return `${protocol}//${host}${clusterPrefix}/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/vnc`;
  }

  vnc(
    onVnc: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/vnc`;
    return ApiProxy.stream(url, onVnc, {
      isJson: false,
      additionalProtocols: ['base64.binary.k8s.io'],
      ...options,
    });
  }

  static kind = 'VirtualMachineInstance';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachineinstances';
}

export default VirtualMachineInstance;
