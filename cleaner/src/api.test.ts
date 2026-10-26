import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowed, dashboardRequest, saveCleaner } from './api';
import { defaultSettings } from './model';
import { recipeObject } from './recipes';

vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
const mockRequest = vi.mocked(request);
beforeEach(() => mockRequest.mockReset());

describe('cluster-scoped API requests', () => {
  it('creates via POST and updates via PUT, preserving the version for conflict detection', async () => {
    const value = { ...recipeObject(), metadata: { name: 'my-policy', resourceVersion: '42' } };
    await saveCleaner('kind-test', value);
    expect(mockRequest).toHaveBeenLastCalledWith(
      '/apis/apps.projectsveltos.io/v1alpha1/cleaners',
      expect.objectContaining({ cluster: 'kind-test', method: 'POST' })
    );
    await saveCleaner('kind-test', value, 'my-policy');
    expect(mockRequest).toHaveBeenLastCalledWith(
      '/apis/apps.projectsveltos.io/v1alpha1/cleaners/my-policy',
      expect.objectContaining({
        cluster: 'kind-test',
        method: 'PUT',
        body: JSON.stringify(value),
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
  it('fails closed when authorization cannot be checked', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Forbidden'));
    expect(await allowed('test', 'cleaners', 'delete')).toBe(false);
    mockRequest.mockResolvedValueOnce({ status: { allowed: false } });
    expect(await allowed('test', 'cleaners', 'create')).toBe(false);
  });
  it('checks the exact dashboard service proxy subresource', async () => {
    mockRequest.mockResolvedValueOnce({ status: { allowed: true } });
    expect(
      await allowed('test', 'services/proxy', 'create', 'k8s-cleaner', 'http:k8s-cleaner-web:9080')
    ).toBe(true);
    const payload = JSON.parse(mockRequest.mock.calls[0][1]!.body as string);
    expect(payload.spec.resourceAttributes).toEqual({
      group: '',
      resource: 'services',
      subresource: 'proxy',
      verb: 'create',
      namespace: 'k8s-cleaner',
      name: 'http:k8s-cleaner-web:9080',
    });
  });
  it('sends real trigger requests through the selected cluster without modifying schedules', async () => {
    await dashboardRequest('kind-test', defaultSettings, 'cleaners/my-policy/trigger', 'POST');
    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/namespaces/k8s-cleaner/services/http:k8s-cleaner-web:9080/proxy/api/v1/cleaners/my-policy/trigger',
      { cluster: 'kind-test', method: 'POST', timeout: 20000 }
    );
  });
});
