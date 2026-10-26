// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
import { createReader, ResourceIdentity, resourceIdentity } from './api';

const ref: ResourceIdentity = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  name: 'settings',
  namespace: 'apps',
  uid: 'original',
  cluster: 'cluster-b',
};
const object = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: { name: 'settings', namespace: 'apps', uid: 'original' },
  data: { value: 'example' },
};
const discovery = { resources: [{ kind: 'ConfigMap', name: 'configmaps', namespaced: true }] };
const signal = () => new AbortController().signal;

describe('resource identity', () => {
  it('captures a resource cluster and identity without storing its values', () => {
    expect(resourceIdentity({ jsonData: object, cluster: 'own-cluster' }, 'url-cluster')).toEqual({
      ...ref,
      cluster: 'own-cluster',
    });
    expect(resourceIdentity(object, 'url-cluster')).toEqual({ ...ref, cluster: 'url-cluster' });
    expect(Object.keys(resourceIdentity(object, 'cluster'))).not.toContain('data');
  });
  it('supports SDK classes whose cached object omits type metadata', () => {
    class Person {
      static kind = 'Person';
      static apiVersion = ['people.example.io/v1', 'people.example.io/v1beta1'];
      jsonData = { metadata: { name: 'alice' } };
      cluster = 'custom-cluster';
    }
    expect(resourceIdentity(new Person(), null)).toEqual({
      apiVersion: 'people.example.io/v1',
      kind: 'Person',
      name: 'alice',
      namespace: undefined,
      uid: undefined,
      cluster: 'custom-cluster',
    });
  });
  it('ignores non-resources and malformed API paths', () => {
    for (const value of [
      null,
      {},
      { ...object, apiVersion: '../v1' },
      { ...object, apiVersion: 'group/../v1' },
      { ...object, apiVersion: 'v1/namespaces/other' },
      { ...object, kind: '../Secret' },
    ])
      expect(resourceIdentity(value, 'cluster')).toBeUndefined();
    expect(resourceIdentity(object, null)).toBeUndefined();
  });
});

describe('read-only Kubernetes object inspection', () => {
  it('discovers actual resource plurals and uses GET in the captured cluster', async () => {
    const transport = vi.fn(async path => (path === '/api/v1' ? discovery : object));
    expect(await createReader(transport).load(ref, signal())).toBe(object);
    expect(transport.mock.calls.map(call => call[0])).toEqual([
      '/api/v1',
      '/api/v1/namespaces/apps/configmaps/settings',
    ]);
    expect(
      transport.mock.calls.every(
        (call: any) =>
          call[1].cluster === 'cluster-b' &&
          call[1].method === 'GET' &&
          call[1].autoLogoutOnAuthError === false
      )
    ).toBe(true);
  });
  it('uses discovery scope for cluster resources and supports irregular CRD plurals', async () => {
    const person = {
      apiVersion: 'people.example.io/v1',
      kind: 'Person',
      metadata: { name: 'alice', uid: 'person' },
    };
    const transport = vi.fn(async path =>
      path === '/apis/people.example.io/v1'
        ? {
            resources: [
              { kind: 'Person', name: 'people', namespaced: false },
              { kind: 'Person', name: 'people/status', namespaced: false },
            ],
          }
        : person
    );
    await createReader(transport).load(
      {
        ...ref,
        apiVersion: person.apiVersion,
        kind: person.kind,
        name: 'alice',
        uid: 'person',
        namespace: 'ignored-global-filter',
      },
      signal()
    );
    expect(transport.mock.calls.map(call => call[0])).toEqual([
      '/apis/people.example.io/v1',
      '/apis/people.example.io/v1/people/alice',
    ]);
  });
  it('falls back to a served API version when the SDK class points at an older version', async () => {
    const person = {
      apiVersion: 'people.example.io/v1',
      kind: 'Person',
      metadata: { name: 'alice' },
    };
    const transport = vi.fn(async path => {
      if (path === '/apis/people.example.io/v1beta1')
        throw Object.assign(new Error('Version removed'), { status: 404 });
      if (path === '/apis/people.example.io')
        return { preferredVersion: { version: 'v1' }, versions: [{ version: 'v1' }] };
      if (path === '/apis/people.example.io/v1')
        return { resources: [{ kind: 'Person', name: 'people', namespaced: false }] };
      return person;
    });
    expect(
      await createReader(transport).load(
        {
          ...ref,
          apiVersion: 'people.example.io/v1beta1',
          kind: 'Person',
          name: 'alice',
          uid: undefined,
        },
        signal()
      )
    ).toBe(person);
    expect(transport.mock.calls.map(call => call[0])).toEqual([
      '/apis/people.example.io/v1beta1',
      '/apis/people.example.io',
      '/apis/people.example.io/v1',
      '/apis/people.example.io/v1/people/alice',
    ]);
  });
  it('reports forbidden access and missing namespaces without guessing endpoints', async () => {
    const denied = vi.fn(async () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    });
    await expect(createReader(denied).load(ref, signal())).rejects.toMatchObject({ status: 403 });
    expect(denied).toHaveBeenCalledTimes(1);
    const transport = vi.fn(async () => discovery);
    await expect(
      createReader(transport).load({ ...ref, namespace: undefined }, signal())
    ).rejects.toThrow('requires a namespace');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects replaced objects and unexpected identities', async () => {
    for (const response of [
      { ...object, metadata: { ...object.metadata, uid: 'replacement' } },
      { ...object, kind: 'Secret' },
      { ...object, metadata: { ...object.metadata, namespace: 'other' } },
    ]) {
      const transport = vi.fn(async path => (path === '/api/v1' ? discovery : response));
      await expect(createReader(transport).load(ref, signal())).rejects.toThrow(
        response.kind === 'ConfigMap' && response.metadata.uid === 'replacement'
          ? 'replaced'
          : 'unexpected resource identity'
      );
    }
  });
  it('cancels stale inspections and bounds hung requests', async () => {
    const abort = new AbortController();
    const transport = vi.fn(async (_path, options) => {
      abort.abort();
      expect(options.signal.aborted).toBe(true);
      return discovery;
    });
    await expect(createReader(transport).load(ref, abort.signal)).rejects.toThrow('cancelled');
    expect(transport).toHaveBeenCalledTimes(1);
    const hanging = vi.fn(
      (_path, options) =>
        new Promise((_, reject) =>
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        )
    );
    await expect(createReader(hanging, 5).load(ref, signal())).rejects.toThrow('timed out');
  });
});
