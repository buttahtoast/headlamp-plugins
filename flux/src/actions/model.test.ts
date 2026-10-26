// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  actionDefinitions,
  buildEditPatch,
  buildPatch,
  CAPABILITIES,
  capability,
  cliCommand,
  exportResource,
  objectPath,
  reconciliationStatus,
  resourceRef,
  sourceReference,
} from './model';

function object(kind = 'Kustomization', name = 'app', spec: Record<string, any> = {}) {
  return {
    apiVersion: `${CAPABILITIES[kind].group}/${kind === 'HelmRelease' ? 'v2' : 'v1'}`,
    kind,
    metadata: {
      name,
      namespace: 'apps',
      uid: `uid-${name}`,
      resourceVersion: '1',
      generation: 2,
      annotations: { 'example.org/keep': 'value' },
    },
    spec,
    status: { observedGeneration: 2, conditions: [{ type: 'Ready', status: 'True' }] },
  };
}

describe('Flux command capabilities', () => {
  it('uses exact groups and exposes supported per-kind commands', () => {
    for (const kind of Object.keys(CAPABILITIES)) {
      const value = object(kind);
      expect(capability(value)).toBe(CAPABILITIES[kind]);
      expect(actionDefinitions(value).some(action => action.id === 'reconcile')).toBe(
        !!CAPABILITIES[kind].reconcile
      );
      expect(actionDefinitions(value).some(action => action.id === 'suspend')).toBe(
        !!CAPABILITIES[kind].suspend
      );
      expect(actionDefinitions(value).some(action => action.id === 'reset')).toBe(
        kind === 'HelmRelease'
      );
      expect(actionDefinitions(value).some(action => action.id === 'force-apply')).toBe(
        kind === 'Kustomization'
      );
      expect(capability({ ...value, apiVersion: 'unrelated.io/v1' })).toBeUndefined();
    }
  });
  it('rejects invalid or suspended operations and scopes URLs to the captured identity', () => {
    expect(() => buildPatch(object('Alert'), 'reconcile', {}, 'token')).toThrow('no reconcile');
    expect(() => buildPatch(object('ExternalArtifact'), 'suspend', {}, 'token')).toThrow(
      'suspension'
    );
    expect(() =>
      buildPatch(object('GitRepository', 'repo', { suspend: true }), 'reconcile', {}, 'token')
    ).toThrow('Resume');
    expect(() => buildPatch(object(), 'reconcile', { reset: true }, 'token')).toThrow(
      'not supported'
    );
    expect(objectPath(resourceRef(object('HelmRelease'), 'cluster-b'))).toBe(
      '/apis/helm.toolkit.fluxcd.io/v2/namespaces/apps/helmreleases/app'
    );
    expect(() => resourceRef(object(), '')).toThrow('cluster');
  });
  it('sets identical one-off force/reset tokens, preserves annotations and tests UID/version', () => {
    const patch = buildPatch(
      object('HelmRelease'),
      'reconcile',
      { force: true, reset: true },
      'unique-token'
    );
    expect(patch.slice(0, 2)).toEqual([
      { op: 'test', path: '/metadata/uid', value: 'uid-app' },
      { op: 'test', path: '/metadata/resourceVersion', value: '1' },
    ]);
    expect(patch.slice(2)).toEqual(
      ['requestedAt', 'forceAt', 'resetAt'].map(key => ({
        op: 'add',
        path: `/metadata/annotations/reconcile.fluxcd.io~1${key}`,
        value: 'unique-token',
      }))
    );
    expect(patch.some(op => op.path.startsWith('/spec'))).toBe(false);
    expect(buildPatch(object(), 'force-apply', { forceApply: true }, 'token').at(-1)).toEqual({
      op: 'add',
      path: '/spec/force',
      value: true,
    });
    expect(() => buildPatch(object('HelmRelease'), 'force-apply', {}, 'token')).toThrow(
      'Kustomization'
    );
  });
  it('treats static OCI repositories and already suspended resources as no-ops', () => {
    expect(
      buildPatch(object('HelmRepository', 'oci', { type: 'oci' }), 'reconcile', {}, 'token')
    ).toEqual([]);
    expect(
      buildPatch(object('GitRepository', 'repo', { suspend: true }), 'suspend', {}, 'token')
    ).toEqual([]);
  });
  it('finds cross-namespace generated charts, direct OCI charts and ordinary sources', () => {
    const value = object('HelmRelease', 'release', {
      chart: {
        spec: { sourceRef: { kind: 'HelmRepository', name: 'repo', namespace: 'sources' } },
      },
    });
    expect(sourceReference(value)).toEqual({
      kind: 'HelmChart',
      name: 'apps-release',
      namespace: 'sources',
      withSource: true,
    });
    expect(
      sourceReference({ ...value, status: { helmChart: 'charts/generated-chart' } })
    ).toMatchObject({ name: 'generated-chart', namespace: 'charts' });
    expect(
      sourceReference(
        object('HelmRelease', 'release', {
          chartRef: { kind: 'OCIRepository', name: 'chart', namespace: 'sources' },
        })
      )
    ).toEqual({ kind: 'OCIRepository', name: 'chart', namespace: 'sources', withSource: false });
    expect(
      sourceReference(
        object('Kustomization', 'app', { sourceRef: { kind: 'GitRepository', name: 'repo' } })
      )
    ).toMatchObject({ namespace: 'apps', name: 'repo' });
  });
  it('produces CLI commands for core and extension actions without fake subcommands', () => {
    expect(
      cliCommand(object('HelmRelease'), 'reconcile', { force: true, reset: true, withSource: true })
    ).toContain('--with-source --force --reset');
    expect(cliCommand(object('Canary'), 'suspend')).toContain('"suspend":true');
    expect(cliCommand(object(), 'force-apply', { forceApply: true })).toContain('"force":true');
    expect(cliCommand(object('ExternalArtifact'), 'delete')).toContain(
      'kubectl delete externalartifacts'
    );
  });
});

describe('controller completion', () => {
  it('requires acknowledgment, current generation and a settled Ready condition', () => {
    const value = object();
    expect(reconciliationStatus(value, 'reconcile', 'token').done).toBe(false);
    value.status['lastHandledReconcileAt'] = 'token';
    expect(reconciliationStatus(value, 'reconcile', 'token')).toEqual({ done: true });
    value.status.observedGeneration = 1;
    expect(reconciliationStatus(value, 'reconcile', 'token').done).toBe(false);
    value.status.observedGeneration = 2;
    value.status.conditions[0]['observedGeneration'] = 1;
    expect(reconciliationStatus(value, 'reconcile', 'token').done).toBe(false);
    value.status.conditions[0]['observedGeneration'] = 2;
    value.status.conditions.push({ type: 'Reconciling', status: 'True' });
    expect(reconciliationStatus(value, 'reconcile', 'token').done).toBe(false);
  });
  it('reports controller failure and suspension rather than success', () => {
    expect(
      reconciliationStatus(
        {
          ...object(),
          status: {
            lastHandledReconcileAt: 'token',
            conditions: [{ type: 'Ready', status: 'False', message: 'Apply failed' }],
          },
        },
        'reconcile',
        'token'
      )
    ).toEqual({ done: true, error: 'Apply failed' });
    expect(
      reconciliationStatus(object('GitRepository', 'repo', { suspend: true }), 'resume').error
    ).toContain('suspended');
    expect(reconciliationStatus(object('Provider'), 'resume')).toEqual({ done: true });
  });
});

describe('portable export and concurrent-safe YAML edits', () => {
  it('strips server fields and deep copies portable definitions', () => {
    const value = object('GitRepository', 'repo', { interval: '1m' });
    const exported = exportResource(value);
    expect(exported.status).toBeUndefined();
    expect(exported.metadata.uid).toBeUndefined();
    exported.spec.interval = '2m';
    expect(value.spec.interval).toBe('1m');
  });
  it('preserves unrelated concurrent edits and rejects conflicts on changed fields', () => {
    const original = exportResource(
      object('GitRepository', 'repo', { interval: '1m', url: 'old-url' })
    );
    const edited = { ...original, spec: { ...original.spec, interval: '5m' } };
    const current = { ...original, spec: { ...original.spec, url: 'new-url' } };
    expect(buildEditPatch(original, edited, current)).toEqual([
      { op: 'test', path: '/spec/interval', value: '1m' },
      { op: 'replace', path: '/spec/interval', value: '5m' },
    ]);
    expect(() =>
      buildEditPatch(original, edited, { ...current, spec: { ...current.spec, interval: '2m' } })
    ).toThrow('changed at /spec/interval');
    expect(() =>
      buildEditPatch(
        original,
        { ...edited, metadata: { ...edited.metadata, name: 'replacement' } },
        current
      )
    ).toThrow('identity');
    expect(() =>
      buildEditPatch(original, { ...edited, status: { healthy: true } }, current)
    ).toThrow('Server fields');
  });
});
