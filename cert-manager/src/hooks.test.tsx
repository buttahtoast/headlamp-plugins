import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScope } from './hooks';

const { state } = vi.hoisted(() => ({
  state: { selected: new Set(['unrelated']), clusters: ['main', 'other'] },
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useCluster: () => 'main', useSelectedClusters: () => state.clusters },
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: any) => selector({ filter: { namespaces: state.selected } }),
}));
vi.mock('./api', async importOriginal => {
  const api = await importOriginal<typeof import('./api')>();
  return { ...api, collect: vi.fn() };
});
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
const storage = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

describe('certificate detail scope', () => {
  it('uses the opened resource namespace and active cluster instead of the overview filters', () => {
    const { result } = renderHook(() => useScope(true, 'certificate-namespace'));
    expect(result.current.scopes).toEqual([
      { cluster: 'main', namespaces: ['certificate-namespace'] },
    ]);
    expect(result.current.namespaces).toEqual(['certificate-namespace']);
  });
  it('continues honoring configured allowed namespaces', () => {
    localStorage.setItem(
      'cluster_settings.main',
      JSON.stringify({ allowedNamespaces: ['allowed'] })
    );
    const { result } = renderHook(() => useScope(true, 'certificate-namespace'));
    expect(result.current.scopes).toEqual([]);
  });
});
