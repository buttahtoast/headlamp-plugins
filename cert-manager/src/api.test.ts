import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect, listPath, patchRenewal, prepareRenewal, resolveNamespaces } from './api';
import { Item, renewalPatch } from './model';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request }));
const cert: Item = {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Certificate',
  cluster: 'target',
  metadata: {
    name: 'tls',
    namespace: 'apps',
    uid: 'original',
    resourceVersion: '12',
    generation: 1,
  },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
};
beforeEach(() => {
  request.mockReset();
});

describe('scoped snapshot collection', () => {
  it('uses allowed namespaces when none are selected, and never widens a disjoint filter', () => {
    expect(resolveNamespaces([], ['a'])).toEqual(['a']);
    expect(resolveNamespaces(['b'], ['a'])).toBeNull();
    expect(resolveNamespaces(['a', 'b'], ['a'])).toEqual(['a']);
  });
  it('paginates and carries cluster identity on every resource', async () => {
    request
      .mockResolvedValueOnce({ items: [cert], metadata: { continue: 'a/b c' } })
      .mockResolvedValueOnce({ items: [{ ...cert, metadata: { name: 'second' } }] });
    const items = await listPath('target', '/apis/cert-manager.io/v1/certificates');
    expect(items).toHaveLength(2);
    expect(items.every(item => item.cluster === 'target')).toBe(true);
    expect(request.mock.calls[1][0]).toContain('continue=a%2Fb%20c');
  });
  it('reports forbidden and absent APIs independently, without blocking successful collections', async () => {
    request.mockImplementation(async (path: string) => {
      if (path.includes('/clusterissuers')) throw { status: 403, message: 'Forbidden' };
      if (path.includes('/orders')) throw { status: 404, message: 'Not found' };
      return { items: path.includes('/certificates?') ? [cert] : [] };
    });
    const results: Record<string, any> = {};
    await collect(
      [{ cluster: 'target', namespaces: ['apps'] }],
      (id, result) => {
        results[id] = result;
      },
      new AbortController().signal
    );
    expect(results.certificates.items).toHaveLength(1);
    expect(results.clusterissuers.error).toContain('Forbidden');
    expect(results.orders.missing).toBe(true);
    expect(request.mock.calls.some(([path]) => path.includes('/deployments'))).toBe(false);
    expect(
      request.mock.calls.some(([path]) => path.includes('/namespaces/apps/certificates'))
    ).toBe(true);
  });
  it('bounds concurrency and discards publication after scope cancellation', async () => {
    let active = 0;
    let peak = 0;
    request.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return { items: [] };
    });
    const abort = new AbortController();
    const publish = vi.fn();
    await collect([{ cluster: 'target', namespaces: ['a', 'b', 'c'] }], publish, abort.signal);
    expect(peak).toBeLessThanOrEqual(6);
    abort.abort();
    publish.mockClear();
    await collect([{ cluster: 'target', namespaces: [] }], publish, abort.signal);
    expect(publish).not.toHaveBeenCalled();
  });
  it('fails boundedly on repeated pagination tokens', async () => {
    request.mockResolvedValue({ items: [], metadata: { continue: 'same' } });
    await expect(listPath('target', '/api/v1/events')).rejects.toThrow('repeated pagination');
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('manual renewal', () => {
  it('refreshes identity, checks the exact status permission and dry-runs before review', async () => {
    request
      .mockResolvedValueOnce(cert)
      .mockResolvedValueOnce({ status: { allowed: true } })
      .mockResolvedValueOnce(cert);
    const prepared = await prepareRenewal(cert);
    const review = JSON.parse(request.mock.calls[1][1].body);
    expect(review.spec.resourceAttributes).toMatchObject({
      namespace: 'apps',
      resource: 'certificates',
      subresource: 'status',
      verb: 'patch',
      name: 'tls',
    });
    expect(request.mock.calls[2][0]).toContain('/status?dryRun=All');
    expect(prepared.live.metadata.resourceVersion).toBe('12');
    await patchRenewal('target', cert, prepared.patch, false);
    expect(request.mock.calls[3][0]).toBe(
      '/apis/cert-manager.io/v1/namespaces/apps/certificates/tls/status'
    );
    expect(request.mock.calls[3][1].cluster).toBe('target');
  });
  it('does not patch replaced or unauthorized certificates', async () => {
    request.mockResolvedValueOnce({ ...cert, metadata: { ...cert.metadata, uid: 'replacement' } });
    await expect(prepareRenewal(cert)).rejects.toThrow('replaced');
    expect(request).toHaveBeenCalledTimes(1);
    request
      .mockReset()
      .mockResolvedValueOnce(cert)
      .mockResolvedValueOnce({ status: { allowed: false } });
    await expect(prepareRenewal(cert)).rejects.toThrow('cannot patch');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('passes concurrency tests unchanged to the status patch', async () => {
    const patch = renewalPatch(cert);
    await patchRenewal('target', cert, patch, false);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(patch);
    expect(request.mock.calls[0][1].headers['Content-Type']).toBe('application/json-patch+json');
  });
});
