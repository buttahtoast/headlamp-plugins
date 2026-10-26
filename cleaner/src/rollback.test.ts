import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ROOT, ResourceInfo } from './model';
import { applyRollback, decodeSnapshot, prepareRollback, resourceToRestore } from './rollback';

vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
const mockRequest = vi.mocked(request);
const saved = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: {
    name: 'saved-settings',
    namespace: 'demo',
    uid: 'original-uid',
    resourceVersion: '7',
    managedFields: [{ manager: 'cleaner' }],
    creationTimestamp: '2026-01-01T00:00:00Z',
    generation: 1,
    deletionTimestamp: '2026-02-01T00:00:00Z',
    annotations: { note: 'keep', 'kubectl.kubernetes.io/last-applied-configuration': 'old' },
  },
  status: { stale: true },
  data: { message: 'Grüezi 🌍' },
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
function entry(value = saved): ResourceInfo {
  return {
    resource: {
      apiVersion: value.apiVersion,
      kind: value.kind,
      name: value.metadata.name,
      namespace: value.metadata.namespace,
      uid: value.metadata.uid,
    },
    fullResource: encode(value),
  };
}
const report = (info = entry()) => ({
  metadata: { uid: 'report-uid', resourceVersion: '20' },
  spec: { action: 'Transform', resourceInfo: [info] },
});
const discovery = { resources: [{ name: 'configmaps', kind: 'ConfigMap', namespaced: true }] };
const live = {
  ...saved,
  metadata: {
    name: 'saved-settings',
    namespace: 'demo',
    uid: 'original-uid',
    resourceVersion: '10',
  },
  status: { current: true },
};
function prepareResponses(existing: typeof live | null = null) {
  mockRequest.mockResolvedValueOnce(report()).mockResolvedValueOnce(discovery);
  if (existing) mockRequest.mockResolvedValueOnce(existing);
  else mockRequest.mockRejectedValueOnce({ status: 404 });
  mockRequest.mockResolvedValueOnce({ status: { allowed: true } });
}
beforeEach(() => mockRequest.mockReset());

describe('saved resource decoding', () => {
  it('decodes UTF-8, strips server metadata and old status, and preserves intended fields', () => {
    const info = entry();
    expect(resourceToRestore(info)).toEqual({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'saved-settings', namespace: 'demo', annotations: { note: 'keep' } },
      data: { message: 'Grüezi 🌍' },
    });
    expect(decodeSnapshot(info)).toEqual(saved);
  });
  it('rejects corrupt data, identity mismatches, and unsafe path components', () => {
    expect(() => decodeSnapshot({ ...entry(), fullResource: '%%%bad' })).toThrow('base64');
    expect(() => decodeSnapshot({ ...entry(), fullResource: encode({}) })).toThrow(
      'valid apiVersion'
    );
    expect(() =>
      decodeSnapshot({ ...entry(), resource: { ...entry().resource, name: 'different' } })
    ).toThrow('does not match');
    expect(() => decodeSnapshot(entry({ ...saved, apiVersion: '../v1' }))).toThrow(
      'valid apiVersion'
    );
    expect(() =>
      decodeSnapshot(entry({ ...saved, metadata: { ...saved.metadata, namespace: '..' } }))
    ).toThrow('valid apiVersion');
  });
});

describe('direct Kubernetes rollback', () => {
  it('recreates a missing object through the selected cluster, without the dashboard', async () => {
    prepareResponses();
    const plan = await prepareRollback('selected-cluster', 'same-as-cleaner', entry());
    expect(plan.operation).toBe('create');
    expect(mockRequest.mock.calls[0][0]).toBe(`${API_ROOT}/reports/same-as-cleaner`);
    const access = JSON.parse(mockRequest.mock.calls[3][1]!.body as string).spec.resourceAttributes;
    expect(access).toEqual({
      group: '',
      resource: 'configmaps',
      verb: 'create',
      namespace: 'demo',
    });
    mockRequest.mockResolvedValueOnce(report()).mockResolvedValueOnce({});
    await applyRollback(plan);
    expect(mockRequest).toHaveBeenLastCalledWith(
      '/api/v1/namespaces/demo/configmaps',
      expect.objectContaining({
        cluster: 'selected-cluster',
        method: 'POST',
        body: JSON.stringify(resourceToRestore(entry())),
      })
    );
    expect(
      mockRequest.mock.calls.every(
        ([url, options]) => !url.includes('/proxy/') && options?.cluster === 'selected-cluster'
      )
    ).toBe(true);
  });
  it('restores existing state with the reviewed version and retains current status', async () => {
    prepareResponses(live);
    const plan = await prepareRollback('cluster', 'cleaner', entry());
    expect(plan.resource.metadata.resourceVersion).toBe('10');
    expect(plan.resource.status).toEqual({ current: true });
    mockRequest
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce({});
    await applyRollback(plan);
    expect(mockRequest).toHaveBeenLastCalledWith(
      '/api/v1/namespaces/demo/configmaps/saved-settings',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(JSON.parse(mockRequest.mock.calls.at(-1)![1]!.body as string).data).toEqual(saved.data);
  });
  it('discovers grouped cluster-scoped endpoints instead of guessing plurals', async () => {
    const info: ResourceInfo = {
      resource: { apiVersion: 'example.test/v1', kind: 'Policy', name: 'example' },
      fullResource: encode({
        apiVersion: 'example.test/v1',
        kind: 'Policy',
        metadata: { name: 'example' },
        spec: { enabled: true },
      }),
    };
    mockRequest
      .mockResolvedValueOnce(report(info))
      .mockResolvedValueOnce({
        resources: [
          { name: 'policies/status', kind: 'Policy', namespaced: false },
          { name: 'policies', kind: 'Policy', namespaced: false },
        ],
      })
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: { allowed: true } });
    const plan = await prepareRollback('cluster', 'cleaner', info);
    expect(plan.path).toBe('/apis/example.test/v1/policies/example');
    expect(
      JSON.parse(mockRequest.mock.calls[3][1]!.body as string).spec.resourceAttributes.group
    ).toBe('example.test');
  });
  it('rejects missing snapshots, Scan reports and a snapshot replaced before preview', async () => {
    for (const spec of [
      { action: 'Scan', resourceInfo: [entry()] },
      { action: 'Delete', resourceInfo: [] },
      { action: 'Transform', resourceInfo: [{ ...entry(), fullResource: encode({}) }] },
    ]) {
      mockRequest.mockResolvedValueOnce({ ...report(), spec });
      await expect(prepareRollback('cluster', 'cleaner', entry())).rejects.toThrow(
        'snapshot changed'
      );
    }
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });
  it('does not treat forbidden reads as missing resources', async () => {
    mockRequest
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(discovery)
      .mockRejectedValueOnce({ status: 403 });
    await expect(prepareRollback('cluster', 'cleaner', entry())).rejects.toEqual({ status: 403 });
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });
  it('blocks restore when the user cannot write the target resource', async () => {
    mockRequest
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(discovery)
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: { allowed: false } });
    await expect(prepareRollback('cluster', 'cleaner', entry())).rejects.toThrow(
      'cannot create configmaps'
    );
  });
  it('rejects a replacement object with the same name but a different UID', async () => {
    mockRequest
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(discovery)
      .mockResolvedValueOnce({ ...live, metadata: { ...live.metadata, uid: 'new-owner' } });
    await expect(prepareRollback('cluster', 'cleaner', entry())).rejects.toThrow(
      'different resource'
    );
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });
  it('refuses changes to the report or live object after confirmation', async () => {
    prepareResponses(live);
    const plan = await prepareRollback('cluster', 'cleaner', entry());
    mockRequest.mockReset().mockResolvedValueOnce({
      ...report(),
      metadata: { uid: 'report-uid', resourceVersion: '21' },
    });
    await expect(applyRollback(plan)).rejects.toThrow('Report changed');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    mockRequest
      .mockReset()
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce({ ...live, metadata: { ...live.metadata, resourceVersion: '11' } });
    await expect(applyRollback(plan)).rejects.toThrow('Resource changed');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
  it('surfaces creation races and API conflicts without falling back to overwrite', async () => {
    prepareResponses();
    const plan = await prepareRollback('cluster', 'cleaner', entry());
    mockRequest.mockReset().mockResolvedValueOnce(report()).mockRejectedValueOnce({ status: 409 });
    await expect(applyRollback(plan)).rejects.toEqual({ status: 409 });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});
