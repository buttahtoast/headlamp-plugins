import { describe, expect, it } from 'vitest';
import {
  buildBackup,
  buildRestore,
  diffObjects,
  Manifest,
  normalize,
  objectId,
  recoveryManifest,
} from './model';

const config: Manifest = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: {
    name: 'settings',
    namespace: 'app',
    uid: 'old',
    resourceVersion: '10',
    managedFields: [{}],
    ownerReferences: [{ uid: 'old-owner' }],
    finalizers: ['example.test/finalizer'],
    annotations: { 'example.test/keep': 'yes' },
  },
  data: { mode: 'before' },
  status: { ready: true },
};

describe('backup and restore requests', () => {
  it('runs the entire schedule template without copying ownership or mutating the schedule', () => {
    const schedule: Manifest = {
      apiVersion: 'velero.io/v1',
      kind: 'Schedule',
      metadata: { name: 'nightly', namespace: 'velero' },
      spec: {
        paused: true,
        template: {
          includedNamespaces: ['app'],
          excludedResources: ['secrets'],
          hooks: { resources: [{ name: 'quiesce' }] },
          resourcePolicy: { kind: 'configmap', name: 'policies' },
          snapshotMoveData: true,
          ttl: '720h',
        },
      },
    };
    const backup = buildBackup('velero', 'manual', schedule.spec!.template, schedule);
    expect(backup.spec).toEqual(schedule.spec!.template);
    expect(backup.metadata.labels).toEqual({ 'velero.io/schedule-name': 'nightly' });
    expect(backup.metadata.ownerReferences).toBeUndefined();
    backup.spec!.hooks.resources[0].name = 'changed';
    expect(schedule.spec!.template.hooks.resources[0].name).toBe('quiesce');
    expect(schedule.spec!.paused).toBe(true);
  });
  it('validates names and namespace mapping before creating restore requests', () => {
    const backup = buildBackup('velero', 'source', {});
    expect(() => buildBackup('velero', 'Invalid/Name', {})).toThrow('DNS label');
    expect(() => buildRestore(backup, 'restore', 'a,b', '', 'target', false)).toThrow(
      'exactly one'
    );
    expect(() => buildRestore(backup, 'restore', '*', '', 'target', false)).toThrow('exactly one');
    const restore = buildRestore(
      backup,
      'restore',
      'app',
      'configmaps,deployments.apps',
      'target',
      false
    );
    expect(restore.spec).toEqual({
      backupName: 'source',
      includedNamespaces: ['app'],
      includedResources: ['configmaps', 'deployments.apps'],
      namespaceMapping: { app: 'target' },
      existingResourcePolicy: 'none',
      restorePVs: false,
    });
  });
});

describe('manifest recovery', () => {
  it('removes server state and dangling ownership while preserving application data', () => {
    const value = recoveryManifest(config, 'recovery');
    expect(value.metadata).toEqual({
      name: 'settings',
      namespace: 'recovery',
      annotations: { 'example.test/keep': 'yes' },
    });
    expect(value.status).toBeUndefined();
    expect(value.data).toEqual({ mode: 'before' });
    expect(config.metadata.ownerReferences).toHaveLength(1);
  });
  it('leaves service addressing to the API server and preserves headless services', () => {
    const service: Manifest = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'api', namespace: 'app' },
      spec: {
        clusterIP: '10.0.0.4',
        clusterIPs: ['10.0.0.4'],
        ports: [{ port: 80, nodePort: 30080 }],
        healthCheckNodePort: 30081,
      },
    };
    expect(recoveryManifest(service).spec).toEqual({ ports: [{ port: 80 }] });
    service.spec!.clusterIP = 'None';
    service.spec!.clusterIPs = ['None'];
    expect(recoveryManifest(service).spec!.clusterIP).toBe('None');
  });
  it.each([
    'Pod',
    'PersistentVolume',
    'PersistentVolumeClaim',
    'VolumeSnapshot',
    'VolumeSnapshotContent',
  ])('requires native Velero handling for %s', kind => {
    expect(() => recoveryManifest({ ...config, kind })).toThrow('Use a Velero restore');
  });
});

describe('meaningful object comparison', () => {
  it('ignores controller status and server metadata but retains application changes', () => {
    const live = JSON.parse(JSON.stringify(config));
    live.metadata.uid = 'new';
    live.metadata.resourceVersion = '99';
    live.status.ready = false;
    live.metadata.labels = { 'velero.io/restore-name': 'restore' };
    expect(diffObjects(normalize(config), normalize(live))).toEqual([]);
    live.data.mode = 'after';
    expect(diffObjects(normalize(config), normalize(live))).toEqual([
      { path: '/data/mode', before: 'before', after: 'after' },
    ]);
  });
  it('identifies additions, removals, arrays and escaped JSON pointer keys', () => {
    expect(
      diffObjects(
        { 'a/b~': 1, removed: true, list: ['a'] },
        { 'a/b~': 2, added: true, list: ['a', 'b'] }
      )
    ).toEqual([
      { path: '/a~1b~0', before: 1, after: 2 },
      { path: '/added', before: undefined, after: true },
      { path: '/list/1', before: undefined, after: 'b' },
      { path: '/removed', before: true, after: undefined },
    ]);
  });
  it('matches API version variants but separates namespaces and API groups', () => {
    expect(objectId({ ...config, apiVersion: 'apps/v1' })).toBe(
      objectId({ ...config, apiVersion: 'apps/v1beta1' })
    );
    expect(objectId(config)).not.toBe(objectId({ ...config, apiVersion: 'other/v1' }));
    expect(diffObjects({ a: 1, b: 1 }, { a: 2, b: 2 }, 1)).toHaveLength(1);
  });
});
