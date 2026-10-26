import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { API_VERSION, CleanerSpec, ReportSpec } from './model';

export interface CleanerObject extends KubeObjectInterface {
  spec: CleanerSpec;
  status?: { lastRunTime?: string; nextScheduleTime?: string; failureMessage?: string };
}

export class Cleaner extends KubeObject<CleanerObject> {
  static kind = 'Cleaner';
  static apiName = 'cleaners';
  static apiVersion = API_VERSION;
  static isNamespaced = false;
  static get detailsRoute() {
    return 'cleaner-policy';
  }
  static get listRoute() {
    return 'cleaner-overview';
  }
  get spec() {
    return this.jsonData.spec;
  }
  get status() {
    return this.jsonData.status;
  }
}

export interface ReportObject extends KubeObjectInterface {
  spec: ReportSpec;
}

export class CleanerReport extends KubeObject<ReportObject> {
  static kind = 'Report';
  static apiName = 'reports';
  static apiVersion = API_VERSION;
  static isNamespaced = false;
  static get detailsRoute() {
    return 'cleaner-report';
  }
  static get listRoute() {
    return 'cleaner-reports';
  }
  get spec() {
    return this.jsonData.spec;
  }
}
