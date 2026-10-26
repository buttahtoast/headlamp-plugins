// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request }));
import { decodeHelmRelease, helmManifestReferences, resolveInventory } from './api';
import { InventoryRecord, parseInventoryEntry } from './model';

beforeEach(() => {
  request.mockReset();
});

describe('Helm rendered release inventory', () => {
  it('decodes the real rendered manifest, including generated names and multiple namespaces', async () => {
    const manifest =
      'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: generated-real-name\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: api\n  namespace: other-team\n';
    const helm = gzipSync(
      JSON.stringify({
        manifest,
        chart: { templates: [{ data: 'unrendered {{ .Release.Name }}' }] },
      })
    ).toString('base64');
    const release = await decodeHelmRelease(Buffer.from(helm).toString('base64'));
    expect(
      helmManifestReferences(release.manifest, 'target').map(ref => [ref.name, ref.namespace])
    ).toEqual([
      ['generated-real-name', 'target'],
      ['api', 'other-team'],
    ]);
  });
  it('handles Kubernetes Lists, empty documents and invalid manifests', () => {
    expect(
      helmManifestReferences(
        '---\napiVersion: v1\nkind: List\nitems:\n- apiVersion: v1\n  kind: ConfigMap\n  metadata: {name: one}\n---\n',
        'app'
      )
    ).toHaveLength(1);
    expect(() => helmManifestReferences('metadata: {name: broken}', 'app')).toThrow('incomplete');
  });
});

describe('inventory API resolution', () => {
  it('discovers actual resource plurals and cluster scope, instead of guessing', async () => {
    request.mockImplementation(async path =>
      path === '/apis/example.io/v1'
        ? { resources: [{ kind: 'Person', name: 'people', namespaced: false }] }
        : { kind: 'Person', apiVersion: 'example.io/v1', metadata: { name: 'test' } }
    );
    const values: InventoryRecord[] = [];
    await resolveInventory(
      'cluster-a',
      [
        {
          id: 'person',
          group: 'example.io',
          version: 'v1',
          kind: 'Person',
          name: 'test',
          namespace: 'wrong-default',
        },
      ],
      value => values.push(value),
      new AbortController().signal
    );
    expect(request.mock.calls.map(call => call[0])).toEqual([
      '/apis/example.io/v1',
      '/apis/example.io/v1/people/test',
    ]);
    expect(values[0]).toMatchObject({ state: 'loaded', namespace: undefined, plural: 'people' });
    expect(request.mock.calls.every(call => call[1].cluster === 'cluster-a')).toBe(true);
  });
  it('distinguishes missing objects, inaccessible objects and unavailable APIs', async () => {
    request.mockImplementation(async path => {
      if (path === '/api/v1')
        return { resources: [{ kind: 'ConfigMap', name: 'configmaps', namespaced: true }] };
      throw Object.assign(new Error('not accessible'), {
        status: path.endsWith('/missing') ? 404 : 403,
      });
    });
    const values: InventoryRecord[] = [];
    await resolveInventory(
      'cluster-a',
      ['missing', 'forbidden'].map(name =>
        parseInventoryEntry({ id: `app_${name}__ConfigMap`, v: 'v1' })
      ),
      value => values.push(value),
      new AbortController().signal
    );
    expect(values.map(value => value.state).sort()).toEqual(['forbidden', 'missing']);
    request.mockImplementation(async () => {
      throw Object.assign(new Error('API not served'), { status: 404 });
    });
    await resolveInventory(
      'cluster-a',
      [parseInventoryEntry({ id: 'app_old__ConfigMap', v: 'v99' })],
      value => values.push(value),
      new AbortController().signal
    );
    expect(values[2].state).toBe('error');
  });
  it('does not publish stale responses after leaving the inventory', async () => {
    const controller = new AbortController();
    const values = [];
    request.mockImplementation(async () => {
      controller.abort();
      return { resources: [] };
    });
    await resolveInventory(
      'cluster-a',
      [parseInventoryEntry({ id: 'app_settings__ConfigMap', v: 'v1' })],
      value => values.push(value),
      controller.signal
    );
    expect(values).toEqual([]);
  });
});
