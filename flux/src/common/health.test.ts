import { describe, expect, it } from 'vitest';
import { controllerReady, fluxState, summarize } from './health';

const resource = (status = {}, spec = {}, kind = 'Kustomization') => ({
  kind,
  metadata: { name: 'app', namespace: 'team', generation: 2 },
  spec,
  status,
});
const ready = { conditions: [{ type: 'Ready', status: 'True', observedGeneration: 2 }] };

describe('Flux status statistics', () => {
  it('does not mark objects without status as healthy', () => {
    expect(fluxState(resource())).toBe('unknown');
    expect(fluxState(resource({}, {}, 'Provider'))).toBe('configured');
  });
  it('recognizes a suspension even before the first Ready condition', () => {
    expect(fluxState(resource({}, { suspend: true }))).toBe('suspended');
  });
  it('does not use readiness from a previous generation', () => {
    expect(
      fluxState(
        resource({ conditions: [{ type: 'Ready', status: 'True', observedGeneration: 1 }] })
      )
    ).toBe('reconciling');
  });
  it('keeps reconciliation failures visible while Flux is retrying', () => {
    expect(
      fluxState(
        resource({
          conditions: [
            { type: 'Reconciling', status: 'True' },
            { type: 'Ready', status: 'False', reason: 'ReconciliationFailed' },
          ],
        })
      )
    ).toBe('failed');
    expect(
      fluxState(
        resource({ conditions: [{ type: 'Ready', status: 'False', reason: 'DependencyNotReady' }] })
      )
    ).toBe('reconciling');
  });
  it('counts all visible namespaces and inventory entries', () => {
    const result = summarize([
      resource({ ...ready, inventory: { entries: [{ id: 'one' }, { id: 'two' }] } }),
      { ...resource({}, { suspend: true }), metadata: { namespace: 'another-team' } },
    ]);
    expect(result).toMatchObject({ total: 2, namespaces: 2, inventory: 2, ready: 1, suspended: 1 });
  });
  it('handles scaled-to-zero controllers without reporting an outage', () => {
    expect(
      controllerReady(resource({ observedGeneration: 2 }, { replicas: 0 }, 'Deployment'))
    ).toBe(true);
    expect(
      controllerReady(
        resource({ readyReplicas: 0, observedGeneration: 2 }, { replicas: 1 }, 'Deployment')
      )
    ).toBe(false);
    expect(
      controllerReady(
        resource({ readyReplicas: 1, observedGeneration: 1 }, { replicas: 1 }, 'Deployment')
      )
    ).toBe(false);
  });
});
