// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
import { CollectionSpec, createOverviewClient } from './client';

const spec: CollectionSpec = {
  id: 'helmreleases',
  kind: 'HelmRelease',
  plural: 'helmreleases',
  versions: ['helm.toolkit.fluxcd.io/v2', 'helm.toolkit.fluxcd.io/v2beta1'],
  namespaced: true,
};
const object = (name: string, namespace = 'team') => ({
  metadata: { name, namespace, uid: `${namespace}/${name}` },
  spec: {},
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
});
const scope = { cluster: 'cluster-b' };
const signal = () => new AbortController().signal;

describe('bounded overview snapshots', () => {
  it('loads all namespaces with finite GET requests, follows pagination and normalizes item types', async () => {
    const request = vi.fn(async path =>
      new URL(path, 'http://cluster').searchParams.has('continue')
        ? { items: [object('two')], metadata: {} }
        : { items: [object('one')], metadata: { continue: 'next/page+token' } }
    );
    const result = await createOverviewClient(request).load(spec, scope, signal());
    expect(result.items.map(item => item.metadata.name)).toEqual(['one', 'two']);
    expect(
      result.items.every(
        item =>
          item.kind === 'HelmRelease' &&
          item.apiVersion === spec.versions[0] &&
          item.cluster === 'cluster-b'
      )
    ).toBe(true);
    expect(request.mock.calls.map(call => new URL(call[0], 'http://cluster').pathname)).toEqual([
      '/apis/helm.toolkit.fluxcd.io/v2/helmreleases',
      '/apis/helm.toolkit.fluxcd.io/v2/helmreleases',
    ]);
    expect(new URL(request.mock.calls[1][0], 'http://cluster').searchParams.get('continue')).toBe(
      'next/page+token'
    );
    expect(
      request.mock.calls.every(
        (call: any) =>
          call[1].method === 'GET' && call[1].cluster === 'cluster-b' && !call[0].includes('watch')
      )
    ).toBe(true);
  });
  it('tries served versions and settles absent optional APIs as missing, not pending', async () => {
    const request = vi.fn(async path => {
      if (path.includes('/v2/')) throw Object.assign(new Error('Not served'), { status: 404 });
      return { items: [] };
    });
    expect(await createOverviewClient(request).load(spec, scope, signal())).toMatchObject({
      items: [],
      missing: false,
    });
    expect(request).toHaveBeenCalledTimes(2);
    request.mockImplementation(async () => {
      throw Object.assign(new Error('Absent'), { status: 404 });
    });
    expect(await createOverviewClient(request).load(spec, scope, signal())).toMatchObject({
      items: [],
      missing: true,
    });
  });
  it('keeps successful namespaces and reports forbidden namespaces without falling back to broader access', async () => {
    const request = vi.fn(async path => {
      if (path.includes('/namespaces/denied/'))
        throw Object.assign(new Error('Forbidden'), { status: 403 });
      return { items: [object('one', 'allowed')] };
    });
    const result = await createOverviewClient(request).load(
      spec,
      { ...scope, namespaces: ['allowed', 'denied'] },
      signal()
    );
    expect(result.items).toHaveLength(1);
    expect(result.error.status).toBe(403);
    expect(request.mock.calls.every(call => call[0].includes('/namespaces/'))).toBe(true);
  });
  it('discovers controllers outside the application namespace filter while honoring allowed namespaces', async () => {
    const request = vi.fn(async (path: string) => {
      expect(path).toContain('deployments');
      return { items: [] };
    });
    await createOverviewClient(request).load(
      {
        id: 'controllers',
        kind: 'Deployment',
        plural: 'deployments',
        versions: ['apps/v1'],
        namespaced: true,
        labelSelector: 'app.kubernetes.io/part-of=flux',
      },
      { ...scope, namespaces: ['app'], controllerNamespaces: ['flux-system'] },
      signal()
    );
    const url = new URL(request.mock.calls[0][0], 'http://cluster');
    expect(url.pathname).toBe('/apis/apps/v1/namespaces/flux-system/deployments');
    expect(url.searchParams.get('labelSelector')).toBe('app.kubernetes.io/part-of=flux');
  });
  it('shows completed collections before a hung optional request settles and bounds even non-aborting transports', async () => {
    const updates: any[] = [];
    const request = vi.fn(path =>
      path.includes('/optional')
        ? new Promise(() => {})
        : Promise.resolve({ items: [object('one')] })
    );
    const task = createOverviewClient(request, 30, 60).run(
      [spec, { ...spec, id: 'optional', plural: 'optional' }],
      [scope],
      (id, result) => updates.push({ id, ...result }),
      signal()
    );
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: 'helmreleases',
      items: [{ metadata: { name: 'one' } }],
    });
    await task;
    expect(updates.at(-1)).toMatchObject({ id: 'optional', error: { status: 408 } });
  });
  it('settles queued collections when the overall refresh deadline is exceeded', async () => {
    const results = new Map();
    const request = vi.fn(() => new Promise(() => {}));
    const specs = Array.from({ length: 15 }, (_, index) => ({ ...spec, id: String(index) }));
    await createOverviewClient(request, 1000, 10).run(
      specs,
      [scope],
      (id, result) => results.set(id, result),
      signal()
    );
    expect(results.size).toBe(15);
    expect([...results.values()].every(result => result.error.status === 408)).toBe(true);
    expect(request).toHaveBeenCalledTimes(6);
  });
  it('cancels stale loads without publishing late values', async () => {
    const abort = new AbortController();
    let resolve: (value: any) => void;
    const request = vi.fn(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const publish = vi.fn();
    const run = createOverviewClient(request).run([spec], [scope], publish, abort.signal);
    abort.abort();
    await run;
    resolve({ items: [object('old')] });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });
  it('combines cluster results without dropping resources from earlier clusters', async () => {
    const request = vi.fn(async (_path, options) => ({ items: [object(options.cluster)] }));
    const publish = vi.fn();
    await createOverviewClient(request).run(
      [spec],
      [{ cluster: 'a' }, { cluster: 'b' }],
      publish,
      signal()
    );
    expect(
      publish.mock.calls
        .at(-1)[1]
        .items.map(item => item.cluster)
        .sort()
    ).toEqual(['a', 'b']);
  });
});
