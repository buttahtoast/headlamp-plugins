import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { allowed, launchAction } = vi.hoisted(() => ({ allowed: vi.fn(), launchAction: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ K8s: { useCluster: () => 'headlamp-cluster' } }));
vi.mock('./client', () => ({ actionClient: { allowed } }));
vi.mock('./session', () => ({
  launchAction,
  updateSession: vi.fn(),
  useActionSession: () => ({ busy: false }),
}));
import { ResourceActions } from './ResourceActions';

const release = {
  apiVersion: 'helm.toolkit.fluxcd.io/v2',
  kind: 'HelmRelease',
  metadata: { name: 'app', namespace: 'apps', uid: 'original', resourceVersion: '1' },
  spec: {},
};
beforeEach(() => {
  allowed.mockReset();
  allowed.mockResolvedValue(true);
  launchAction.mockReset();
});
afterEach(cleanup);

describe('resource action menu', () => {
  it('launches a Helm reset with captured identity and cluster', async () => {
    render(<ResourceActions resource={{ ...release, cluster: 'explicit-cluster' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const reset = await screen.findByRole('menuitem', { name: 'Reset failures and reconcile' });
    await waitFor(() => expect(reset.getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(reset);
    expect(launchAction).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          ref: expect.objectContaining({ uid: 'original', cluster: 'explicit-cluster' }),
        }),
      ],
      expect.objectContaining({ operation: 'reconcile', options: { reset: true } })
    );
  });
  it('disables mutations denied by RBAC while keeping inspections available', async () => {
    allowed.mockResolvedValue(false);
    render(<ResourceActions resource={release} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await waitFor(() =>
      expect(
        screen
          .getByRole('menuitem', { name: /Reconcile Your Kubernetes permissions/ })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );
    expect(
      screen.getByRole('menuitem', { name: 'View YAML' }).getAttribute('aria-disabled')
    ).not.toBe('true');
  });
  it('offers only shared supported actions for a mixed bulk selection', async () => {
    const external = {
      ...release,
      kind: 'ExternalArtifact',
      apiVersion: 'source.toolkit.fluxcd.io/v1',
      metadata: { ...release.metadata, name: 'external', uid: 'external' },
    };
    render(<ResourceActions resources={[release, external]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions (2)' }));
    expect(screen.queryByRole('menuitem', { name: 'Reconcile' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Suspend' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit YAML' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export YAML' }));
    expect(launchAction.mock.calls[0][0]).toHaveLength(2);
  });
});
