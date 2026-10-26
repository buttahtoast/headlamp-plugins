import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

interface VeleroObject extends KubeObjectInterface {
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

export class Backup extends KubeObject<VeleroObject> {
  static kind = 'Backup';
  static apiName = 'backups';
  static apiVersion = 'velero.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'velero-backup';
  }
}

export class Schedule extends KubeObject<VeleroObject> {
  static kind = 'Schedule';
  static apiName = 'schedules';
  static apiVersion = 'velero.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'velero-schedule';
  }
}

export class Restore extends KubeObject<VeleroObject> {
  static kind = 'Restore';
  static apiName = 'restores';
  static apiVersion = 'velero.io/v1';
  static isNamespaced = true;
  static get detailsRoute() {
    return 'velero-restore';
  }
}
