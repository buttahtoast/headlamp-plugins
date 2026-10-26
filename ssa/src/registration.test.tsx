import { describe, expect, it, vi } from 'vitest';
const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  registerDetailsViewHeaderActionsProcessor: register,
}));
vi.mock('./ResourceInspector', () => ({ SSAAction: () => null }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
import { ACTION_ID, addSSAAction } from './index';

describe('global resource header registration', () => {
  it('registers once and adds the inspector to built-in, cluster-scoped and custom resource headers', () => {
    expect(register).toHaveBeenCalledWith({ id: ACTION_ID, processor: addSSAAction });
    for (const resource of [
      { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'app', namespace: 'apps' } },
      { apiVersion: 'v1', kind: 'Node', metadata: { name: 'node-one' } },
      {
        apiVersion: 'apiextensions.k8s.io/v1',
        kind: 'CustomResourceDefinition',
        metadata: { name: 'people.example.io' },
      },
      {
        apiVersion: 'example.io/v1',
        kind: 'Person',
        metadata: { name: 'alice', namespace: 'apps' },
      },
    ]) {
      const actions = [{ id: 'EDIT' }, { id: 'DELETE' }, { id: 'flux-managed-indicator' }];
      const result = addSSAAction({ jsonData: resource, cluster: 'cluster-b' }, actions);
      expect(result.slice(0, 3)).toEqual(actions);
      expect(result.at(-1).id).toBe(ACTION_ID);
      expect(addSSAAction(resource, result)).toBe(result);
      expect(actions).toHaveLength(3);
    }
  });
  it('leaves loading views and non-resource pages alone', () => {
    const actions = [{ id: 'existing' }];
    for (const value of [null, {}, { kind: 'Overview' }])
      expect(addSSAAction(value, actions)).toBe(actions);
  });
});
