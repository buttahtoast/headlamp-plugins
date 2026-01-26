import ApiProxy, { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface AddVolumeRequest {
  name: string;
  disk: {
    name: string;
    disk?: {
      bus?: string;
    };
    serial?: string;
  };
  volumeSource: {
    dataVolume?: {
      name: string;
      hotpluggable?: boolean;
    };
    persistentVolumeClaim?: {
      claimName: string;
      hotpluggable?: boolean;
    };
  };
  dryRun?: boolean;
}

interface RemoveVolumeRequest {
  name: string;
  dryRun?: boolean;
}

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

  /**
   * Hot-plug a volume to a running VM
   * @param volumeName - Name for the new volume
   * @param sourceType - 'dataVolume' or 'persistentVolumeClaim'
   * @param sourceName - Name of the DataVolume or PVC
   * @param bus - Disk bus type (default: 'scsi')
   * @param dryRun - If true, validate without applying
   */
  async addVolume(
    volumeName: string,
    sourceType: 'dataVolume' | 'persistentVolumeClaim',
    sourceName: string,
    bus: string = 'scsi',
    dryRun: boolean = false
  ): Promise<void> {
    const request: AddVolumeRequest = {
      name: volumeName,
      disk: {
        name: volumeName,
        disk: {
          bus: bus,
        },
      },
      volumeSource: {},
    };

    if (sourceType === 'dataVolume') {
      request.volumeSource.dataVolume = {
        name: sourceName,
        hotpluggable: true,
      };
    } else {
      request.volumeSource.persistentVolumeClaim = {
        claimName: sourceName,
        hotpluggable: true,
      };
    }

    if (dryRun) {
      request.dryRun = true;
    }

    await ApiProxy.request(
      `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/addvolume`,
      {
        method: 'PUT',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  /**
   * Hot-unplug a volume from a running VM
   * @param volumeName - Name of the volume to remove
   * @param dryRun - If true, validate without applying
   */
  async removeVolume(volumeName: string, dryRun: boolean = false): Promise<void> {
    const request: RemoveVolumeRequest = {
      name: volumeName,
    };

    if (dryRun) {
      request.dryRun = true;
    }

    await ApiProxy.request(
      `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/removevolume`,
      {
        method: 'PUT',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  /**
   * Get the list of hotpluggable volumes attached to this VM
   */
  getHotpluggableVolumes(): { name: string; source: string; type: string }[] {
    const volumes = this.spec?.template?.spec?.volumes || [];
    const hotpluggable: { name: string; source: string; type: string }[] = [];

    for (const volume of volumes) {
      if (volume.dataVolume?.hotpluggable) {
        hotpluggable.push({
          name: volume.name,
          source: volume.dataVolume.name,
          type: 'dataVolume',
        });
      } else if (volume.persistentVolumeClaim?.hotpluggable) {
        hotpluggable.push({
          name: volume.name,
          source: volume.persistentVolumeClaim.claimName,
          type: 'persistentVolumeClaim',
        });
      }
    }

    return hotpluggable;
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

  /**
   * Create a port-forward connection to the VM via the KubeVirt portforward subresource.
   */
  portforward(
    port: number,
    onData: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const vmiData = {
      ...this.jsonData,
      kind: VirtualMachineInstance.kind,
      apiVersion: VirtualMachineInstance.apiVersion,
    };
    const instance = new VirtualMachineInstance(vmiData);
    return instance.portforward(port, onData, options);
  }

  /**
   * Get the WebSocket URL for port forwarding to this VM.
   */
  getPortforwardUrl(port: number): string {
    const vmiData = {
      ...this.jsonData,
      kind: VirtualMachineInstance.kind,
      apiVersion: VirtualMachineInstance.apiVersion,
    };
    const instance = new VirtualMachineInstance(vmiData);
    return instance.getPortforwardUrl(port);
  }

  static kind = 'VirtualMachine';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachines';
}

export default VirtualMachine;
