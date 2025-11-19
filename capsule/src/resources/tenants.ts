import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export class Tenants extends KubeObject<TenantsObject> {
  static kind: string = 'Tenant';
  static apiVersion: string = 'capsule.clastix.io/v1beta2';
  static apiName: string = 'tenants';

  static isNamespaced: boolean = false;

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }
}

export interface TenantsObject extends KubeObjectInterface {
  spec?: {
    owners?: Array<{
      apiGroup: string;
      kind: string;
      name: string;
    }>;
    tenant?: string;
    namespaces?: string[];
    storageClasses?: string[];
    additionalPodSpecs?: {
      nodeSelector?: Record<string, string>;
      affinity?: {
        nodeAffinity?: {
          requiredDuringSchedulingIgnoredDuringExecution?: {
            nodeSelectorTerms: Array<{
              matchExpressions: Array<{
                key: string;
                operator: string;
                values?: string[];
              }>;
            }>;
          };
          preferredDuringSchedulingIgnoredDuringExecution?: Array<{
            weight: number;
            preference: {
              matchExpressions: Array<{
                key: string;
                operator: string;
                values?: string[];
              }>;
            };
          }>;
        };
        podAffinity?: {
          requiredDuringSchedulingIgnoredDuringExecution?: Array<{
            labelSelector: {
              matchExpressions: Array<{
                key: string;
                operator: string;
                values?: string[];
              }>;
            };
            topologyKey: string;
          }>;
          preferredDuringSchedulingIgnoredDuringExecution?: Array<{
            weight: number;
            podAffinityTerm: {
              labelSelector: {
                matchExpressions: Array<{
                  key: string;
                  operator: string;
                  values?: string[];
                }>;
              };
              topologyKey: string;
            };
          }>;
        };
        podAntiAffinity?: {
          requiredDuringSchedulingIgnoredDuringExecution?: Array<{
            labelSelector: {
              matchExpressions: Array<{
                key: string;
                operator: string;
                values?: string[];
              }>;
            };
            topologyKey: string;
          }>;
          preferredDuringSchedulingIgnoredDuringExecution?: Array<{
            weight: number;
            podAffinityTerm: {
              labelSelector: {
                matchExpressions: Array<{
                  key: string;
                  operator: string;
                  values?: string[];
                }>;
              };
              topologyKey: string;
            };
          }>;
        };
      };
      tolerations?: Array<{
        key?: string;
        operator: string;
        value?: string;
        effect: string;
        tolerationSeconds?: number;
      }>;
      priorityClassName?: string;
      imagePullSecrets?: string[];
      imagePullPolicy?: string;
      serviceAccountName?: string;
      runAsUser?: number;
      runAsGroup?: number;
      runAsNonRoot?: boolean;
      fsGroup?: number;
      supplementalGroups?: number[];
      securityContext?: Record<string, any>;
      volumes?: string[];
      volumeMounts?: Array<{
        name: string;
        mountPath: string;
        readOnly?: boolean;
        subPath?: string;
      }>;
      env?: Array<{
        name: string;
        value?: string;
        valueFrom?: {
          configMapKeyRef?: {
            name: string;
            key: string;
          };
          secretKeyRef?: {
            name: string;
            key: string;
          };
        };
      }>;
      envFrom?: Array<{
        configMapRef?: {
          name: string;
        };
        secretRef?: {
          name: string;
        };
      }>;
      resources?: {
        limits?: Record<string, string>;
        requests?: Record<string, string>;
      };
      revisionHistoryLimit?: number;
      forceDeleteGracePeriod?: number;
      podSecurityContext?: Record<string, any>;
    };
    forbiddenAnnotations?: string[];
    forbiddenLabels?: string[];
    forceMinAllocatedResources?: {
      requests?: Record<string, string>;
      limits?: Record<string, string>;
    };
  };
  status?: {
    observedGeneration?: number;
    state: string;
    conditions?: Array<{
      type: string;
      status: string;
      lastTransitionTime: string;
      reason: string;
      message: string;
    }>;
  };
}
