// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
import { ResourceData } from '../common/health';
import { createActionClient, Progress, Transport } from './client';
import { CAPABILITIES, objectPath, resourceRef } from './model';

function object(
  kind: string,
  name: string,
  spec: Record<string, any> = {},
  namespace = 'apps'
): ResourceData {
  return {
    apiVersion: `${CAPABILITIES[kind].group}/${kind === 'HelmRelease' ? 'v2' : 'v1'}`,
    kind,
    metadata: { name, namespace, uid: `uid-${name}`, resourceVersion: '1', generation: 1 },
    spec,
    status: { observedGeneration: 1, conditions: [{ type: 'Ready', status: 'True' }] },
  };
}
const clone = (value: any) => JSON.parse(JSON.stringify(value));
function server(
  objects: ResourceData[],
  config: { deny?: string; fail?: string; pending?: boolean; onPatch?: () => void } = {}
) {
  const values = new Map(
    objects.map(value => [objectPath(resourceRef(value, 'cluster-b')), clone(value)])
  );
  const calls: { path: string; options: Parameters<Transport>[1] }[] = [];
  const transport: Transport = async (path, options) => {
    calls.push({ path, options });
    const body = options.body && JSON.parse(options.body);
    if (path.endsWith('selfsubjectaccessreviews'))
      return { status: { allowed: body.spec.resourceAttributes.name !== config.deny } };
    if (path === '/apis/source.toolkit.fluxcd.io')
      return { preferredVersion: { version: 'v1' }, versions: [{ version: 'v1' }] };
    if (path === '/apis/source.toolkit.fluxcd.io/v1')
      return {
        resources: Object.entries(CAPABILITIES)
          .filter(([, cap]) => cap.group === 'source.toolkit.fluxcd.io')
          .map(([kind, cap]) => ({ kind, name: cap.plural, namespaced: true })),
      };
    const key = path.split('?')[0];
    const value = values.get(key);
    if (!value) throw new Error(`404: ${path}`);
    if (path.includes('dryRun=')) return clone(value);
    if (options.method === 'DELETE') {
      expect(body.preconditions).toEqual({
        uid: value.metadata.uid,
        resourceVersion: value.metadata.resourceVersion,
      });
      values.delete(key);
      return {};
    }
    if (options.method === 'PATCH') {
      for (const operation of body) {
        const parts = operation.path
          .slice(1)
          .split('/')
          .map((part: string) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
        const parent = parts
          .slice(0, -1)
          .reduce((current: any, part: string) => current[part], value);
        const field = parts.at(-1);
        if (operation.op === 'test') {
          if (JSON.stringify(parent[field]) !== JSON.stringify(operation.value))
            throw new Error('Conflict: precondition failed');
        } else if (operation.op === 'remove') delete parent[field];
        else parent[field] = clone(operation.value);
      }
      value.metadata.resourceVersion = String(Number(value.metadata.resourceVersion) + 1);
      value.status.observedGeneration = value.metadata.generation;
      if (!config.pending)
        value.status.lastHandledReconcileAt =
          value.metadata.annotations?.['reconcile.fluxcd.io/requestedAt'];
      if (config.fail === value.metadata.name)
        value.status.conditions = [
          { type: 'Ready', status: 'False', message: 'Controller apply failed' },
        ];
      config.onPatch?.();
    }
    return clone(value);
  };
  return {
    values,
    calls,
    client: createActionClient(transport, 1),
    actual: () =>
      calls.filter(
        call => ['PATCH', 'DELETE'].includes(call.options.method) && !call.path.includes('dryRun=')
      ),
  };
}

describe('review and execution of Flux actions', () => {
  it('checks every target and dry-runs before any mutation; pins every request to its cluster', async () => {
    const resources = [object('GitRepository', 'one'), object('GitRepository', 'two')];
    const fake = server(resources);
    const steps = await fake.client.prepare(
      resources.map(value => resourceRef(value, 'cluster-b')),
      'suspend',
      {}
    );
    expect(fake.actual()).toHaveLength(0);
    expect(fake.calls.filter(call => call.path.includes('dryRun='))).toHaveLength(2);
    expect(fake.calls.filter(call => call.path.endsWith('accessreviews'))).toHaveLength(2);
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(fake.actual()).toHaveLength(2);
    expect(progress.filter(value => value.state === 'completed')).toHaveLength(2);
    expect(
      fake.calls.every(
        call => call.options.cluster === 'cluster-b' && call.options.autoLogoutOnAuthError === false
      )
    ).toBe(true);
  });
  it('makes no changes when any selected target is forbidden', async () => {
    const resources = [object('GitRepository', 'one'), object('GitRepository', 'two')];
    const fake = server(resources, { deny: 'two' });
    await expect(
      fake.client.prepare(
        resources.map(value => resourceRef(value, 'cluster-b')),
        'suspend',
        {}
      )
    ).rejects.toThrow('Permission denied');
    expect(fake.actual()).toHaveLength(0);
  });
  it('waits for repository → generated HelmChart → HelmRelease and deduplicates a shared source', async () => {
    const repo = object('HelmRepository', 'repo', {}, 'sources');
    const chart = object(
      'HelmChart',
      'apps-release',
      { sourceRef: { kind: 'HelmRepository', name: 'repo' } },
      'sources'
    );
    const release = object('HelmRelease', 'release', {
      chart: {
        spec: { sourceRef: { kind: 'HelmRepository', name: 'repo', namespace: 'sources' } },
      },
    });
    const second = object('HelmRelease', 'second', {
      chartRef: { kind: 'HelmChart', name: 'apps-release', namespace: 'sources' },
    });
    const fake = server([repo, chart, release, second]);
    const steps = await fake.client.prepare(
      [release, second].map(value => resourceRef(value, 'cluster-b')),
      'reconcile',
      { withSource: true, wait: false }
    );
    expect(steps.map(step => step.ref.kind)).toEqual([
      'HelmRepository',
      'HelmChart',
      'HelmRelease',
      'HelmRelease',
    ]);
    expect(steps.slice(0, 2).every(step => step.mustWait)).toBe(true);
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(
      progress
        .filter(value => ['completed', 'submitted'].includes(value.state))
        .map(value => value.state)
    ).toEqual(['completed', 'completed', 'submitted', 'submitted']);
    expect(fake.actual().map(call => call.path.split('/').at(-1))).toEqual([
      'repo',
      'apps-release',
      'release',
      'second',
    ]);
  });
  it('skips dependent resources after a source fails while retaining independent bulk results', async () => {
    const repo = object('GitRepository', 'repo');
    const app = object('Kustomization', 'app', {
      sourceRef: { kind: 'GitRepository', name: 'repo' },
    });
    const fake = server([repo, app], { fail: 'repo' });
    const steps = await fake.client.prepare([resourceRef(app, 'cluster-b')], 'reconcile', {
      withSource: true,
    });
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(
      progress
        .filter(value => ['failed', 'skipped'].includes(value.state))
        .map(value => value.state)
    ).toEqual(['failed', 'skipped']);
    expect(fake.actual()).toHaveLength(1);
  });
  it('does not act on a resource replaced after review', async () => {
    const repo = object('GitRepository', 'repo');
    const fake = server([repo]);
    const steps = await fake.client.prepare([resourceRef(repo, 'cluster-b')], 'suspend', {});
    fake.values.get(objectPath(steps[0].ref)).metadata.uid = 'replacement';
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(progress.at(-1)).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('replaced'),
    });
    expect(fake.actual()).toHaveLength(0);
  });
  it('preserves independent bulk results when one controller fails', async () => {
    const resources = [object('GitRepository', 'one'), object('GitRepository', 'two')];
    const fake = server(resources, { fail: 'one' });
    const steps = await fake.client.prepare(
      resources.map(value => resourceRef(value, 'cluster-b')),
      'reconcile',
      {}
    );
    const results = await fake.client.execute(steps, () => {});
    expect([...results.values()]).toEqual(['failed', 'completed']);
    expect(fake.actual()).toHaveLength(2);
  });
  it('rejects deletion if desired configuration changed after review', async () => {
    const app = object('Kustomization', 'app', { prune: false });
    const fake = server([app]);
    const steps = await fake.client.prepare([resourceRef(app, 'cluster-b')], 'delete', {});
    fake.values.get(objectPath(steps[0].ref)).spec.prune = true;
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(progress.at(-1).message).toContain('Review deletion again');
    expect(fake.actual()).toHaveLength(0);
  });
  it('requires force/reset acknowledgments as well as reconciliation acknowledgment', async () => {
    const release = object('HelmRelease', 'release');
    const fake = server([release]);
    const steps = await fake.client.prepare([resourceRef(release, 'cluster-b')], 'reconcile', {
      force: true,
      reset: true,
      timeoutMs: 5,
    });
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(progress.at(-1)).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('Timed out'),
    });
    expect(fake.values.get(objectPath(steps[0].ref)).status.lastHandledReconcileAt).toBe(
      steps[0].token
    );
  });
  it('requires review again when the source reference changes', async () => {
    const app = object('Kustomization', 'app', {
      sourceRef: { kind: 'GitRepository', name: 'repo' },
    });
    const fake = server([app]);
    const steps = await fake.client.prepare([resourceRef(app, 'cluster-b')], 'reconcile', {});
    fake.values.get(objectPath(steps[0].ref)).spec.sourceRef.name = 'other-repo';
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(progress.at(-1).message).toContain('source reference changed');
    expect(fake.actual()).toHaveLength(0);
  });
  it('reports timeout instead of success after only submitting an annotation', async () => {
    const repo = object('GitRepository', 'repo');
    const fake = server([repo], { pending: true });
    const steps = await fake.client.prepare([resourceRef(repo, 'cluster-b')], 'reconcile', {
      timeoutMs: 5,
    });
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value));
    expect(progress.at(-1)).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('Timed out'),
    });
    expect(fake.actual()).toHaveLength(1);
  });
  it('stops pending work and distinguishes accepted changes from rollback', async () => {
    const abort = new AbortController();
    const resources = [object('GitRepository', 'one'), object('GitRepository', 'two')];
    const fake = server(resources, { onPatch: () => abort.abort() });
    const steps = await fake.client.prepare(
      resources.map(value => resourceRef(value, 'cluster-b')),
      'reconcile',
      {}
    );
    const progress: Progress[] = [];
    await fake.client.execute(steps, value => progress.push(value), abort.signal);
    expect(fake.actual()).toHaveLength(1);
    expect(progress.filter(value => value.state === 'stopped')).toHaveLength(2);
    expect(progress.at(-1).message).toContain('Submitted changes remain');
  });
  it('deletes using UID and resourceVersion preconditions after a dry-run', async () => {
    const repo = object('GitRepository', 'repo');
    const fake = server([repo]);
    const steps = await fake.client.prepare([resourceRef(repo, 'cluster-b')], 'delete', {});
    expect(fake.actual()).toHaveLength(0);
    expect(
      JSON.parse(fake.calls.find(call => call.options.method === 'DELETE').options.body).dryRun
    ).toEqual(['All']);
    const results = await fake.client.execute(steps, () => {});
    expect(results.get(steps[0].id)).toBe('submitted');
    expect(fake.values.size).toBe(0);
    expect(JSON.parse(fake.actual()[0].options.body).dryRun).toBeUndefined();
  });
  it('resumes static notification configs without waiting for a nonexistent Ready condition', async () => {
    const provider = object('Provider', 'chat', { suspend: true });
    provider.status = {};
    const fake = server([provider]);
    const steps = await fake.client.prepare([resourceRef(provider, 'cluster-b')], 'resume', {});
    expect((await fake.client.execute(steps, () => {})).get(steps[0].id)).toBe('completed');
  });
});
