import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class NetworkAttachmentDefinition extends KubeObject {
  constructor(jsonData: any) {
    super(jsonData);
  }

  get spec() {
    return this.jsonData.spec;
  }

  // Get the CNI config as parsed JSON
  getConfig(): any {
    try {
      const configStr = this.spec?.config;
      if (configStr) {
        return JSON.parse(configStr);
      }
    } catch (e) {
      console.error('Failed to parse NAD config:', e);
    }
    return null;
  }

  // Get the CNI plugin type (e.g., bridge, macvlan, ipvlan, etc.)
  getPluginType(): string {
    const config = this.getConfig();
    if (config?.type) {
      return config.type;
    }
    // Handle plugins array format
    if (config?.plugins?.length > 0) {
      return config.plugins.map((p: any) => p.type).join(', ');
    }
    return 'unknown';
  }

  // Get IPAM type if configured
  getIpamType(): string {
    const config = this.getConfig();
    if (config?.ipam?.type) {
      return config.ipam.type;
    }
    // Check plugins array
    if (config?.plugins) {
      for (const plugin of config.plugins) {
        if (plugin.ipam?.type) {
          return plugin.ipam.type;
        }
      }
    }
    return '-';
  }

  // Get MTU if configured
  getMTU(): number | null {
    const config = this.getConfig();
    if (config?.mtu) {
      return config.mtu;
    }
    // Check plugins array
    if (config?.plugins) {
      for (const plugin of config.plugins) {
        if (plugin.mtu) {
          return plugin.mtu;
        }
      }
    }
    return null;
  }

  // Get VLAN ID if configured
  getVLAN(): number | null {
    const config = this.getConfig();
    if (config?.vlan !== undefined) {
      return config.vlan;
    }
    // Check plugins array
    if (config?.plugins) {
      for (const plugin of config.plugins) {
        if (plugin.vlan !== undefined) {
          return plugin.vlan;
        }
      }
    }
    return null;
  }

  // Get bridge name if configured
  getBridge(): string | null {
    const config = this.getConfig();
    return config?.bridge || null;
  }

  // Get master interface if configured (for macvlan/ipvlan)
  getMaster(): string | null {
    const config = this.getConfig();
    return config?.master || null;
  }

  static kind = 'NetworkAttachmentDefinition';
  static apiVersion = 'k8s.cni.cncf.io/v1';
  static isNamespaced = true;
  static apiName = 'network-attachment-definitions';
}

export default NetworkAttachmentDefinition;
