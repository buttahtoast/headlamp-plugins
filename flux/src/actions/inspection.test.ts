// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
import { matchesLog } from './inspection';

describe('resource-scoped controller logs', () => {
  const ref = {
    kind: 'GitRepository',
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    namespace: 'apps',
    name: 'repo',
    cluster: 'cluster-b',
  };
  it('matches structured controller metadata and exact namespace/name', () => {
    expect(
      matchesLog(
        JSON.stringify({ controllerKind: 'GitRepository', name: 'repo', namespace: 'apps' }),
        ref
      )
    ).toBe(true);
    expect(
      matchesLog(JSON.stringify({ gitRepository: { name: 'repo', namespace: 'apps' } }), ref)
    ).toBe(true);
    expect(
      matchesLog(
        JSON.stringify({ controllerKind: 'GitRepository', name: 'repo', namespace: 'other' }),
        ref
      )
    ).toBe(false);
    expect(
      matchesLog(
        JSON.stringify({ controllerKind: 'HelmRelease', name: 'repo', namespace: 'apps' }),
        ref
      )
    ).toBe(false);
    expect(matchesLog('unrelated free text containing repo apps', ref)).toBe(false);
  });
});
