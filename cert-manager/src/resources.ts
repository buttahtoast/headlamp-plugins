import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

interface CertManagerObject extends KubeObjectInterface {
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

export class Certificate extends KubeObject<CertManagerObject> {
  static kind = 'Certificate';
  static apiName = 'certificates';
  static apiVersion = 'cert-manager.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'cert-manager-certificates-detail';
  }
}
export class Issuer extends KubeObject<CertManagerObject> {
  static kind = 'Issuer';
  static apiName = 'issuers';
  static apiVersion = 'cert-manager.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'cert-manager-issuers-detail';
  }
}
export class ClusterIssuer extends KubeObject<CertManagerObject> {
  static kind = 'ClusterIssuer';
  static apiName = 'clusterissuers';
  static apiVersion = 'cert-manager.io/v1';
  static isNamespaced = false;
  static get detailsRoute() {
    return 'cert-manager-clusterissuers-detail';
  }
}
export class CertificateRequest extends KubeObject<CertManagerObject> {
  static kind = 'CertificateRequest';
  static apiName = 'certificaterequests';
  static apiVersion = 'cert-manager.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'cert-manager-certificaterequests-detail';
  }
}
export class Order extends KubeObject<CertManagerObject> {
  static kind = 'Order';
  static apiName = 'orders';
  static apiVersion = 'acme.cert-manager.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'cert-manager-orders-detail';
  }
}
export class Challenge extends KubeObject<CertManagerObject> {
  static kind = 'Challenge';
  static apiName = 'challenges';
  static apiVersion = 'acme.cert-manager.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'cert-manager-challenges-detail';
  }
}
export const resourceClasses = {
  certificates: Certificate,
  issuers: Issuer,
  clusterissuers: ClusterIssuer,
  certificaterequests: CertificateRequest,
  orders: Order,
  challenges: Challenge,
};
