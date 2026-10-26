import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ K8s: { useCluster: () => 'url-cluster' } }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
vi.mock('./api', async importOriginal => ({ ...(await importOriginal<any>()), reader: { load } }));
import { SSAAction, SSAResourceDialog } from './ResourceInspector';
import { ManagerDiff } from './shared/ManagerDiff';

afterEach(cleanup);
beforeEach(() => {
  load.mockReset();
});
const object = {
  apiVersion: 'example.io/v1',
  kind: 'Person',
  metadata: {
    name: 'alice',
    namespace: 'team',
    uid: 'one',
    managedFields: [
      {
        manager: 'custom-operator',
        operation: 'Apply',
        fieldsV1: { 'f:spec': { 'f:managed': {} } },
      },
      { manager: 'kubectl', operation: 'Apply', fieldsV1: { 'f:spec': { 'f:manual': {} } } },
      {
        manager: 'kube-controller-manager',
        operation: 'Update',
        subresource: 'status',
        fieldsV1: { 'f:status': {} },
      },
    ],
  },
  spec: { managed: 'generated', manual: 'editable' },
  status: { phase: 'Ready' },
};

describe('manager selection on arbitrary resources', () => {
  it('selects arbitrary Apply managers and optionally exposes status ownership', () => {
    render(<ManagerDiff object={object} />);
    let diff = screen.getByLabelText('SSA field ownership diff');
    expect(
      within(diff).getByText('managed: "generated"').parentElement.getAttribute('data-managed')
    ).toBe('true');
    expect(
      within(diff).getByText('manual: "editable"').parentElement.getAttribute('data-managed')
    ).toBe('true');
    expect(
      within(diff).getByText('phase: "Ready"').parentElement.getAttribute('data-managed')
    ).toBeNull();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'custom-operator · Apply' }));
    diff = screen.getByLabelText('SSA field ownership diff');
    expect(
      within(diff).getByText('manual: "editable"').parentElement.getAttribute('data-managed')
    ).toBeNull();
    fireEvent.click(screen.getByLabelText('Include status and subresources'));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      screen.getByRole('option', { name: 'kube-controller-manager · Update · status' })
    );
    expect(screen.getByText(/selection includes Update operations/)).toBeTruthy();
    diff = screen.getByLabelText('SSA field ownership diff');
    expect(
      within(diff).getByText('phase: "Ready"').parentElement.getAttribute('data-managed')
    ).toBe('true');
    expect(
      within(diff).getByText('managed: "generated"').parentElement.getAttribute('data-managed')
    ).toBeNull();
  });
  it('handles resources with only Update records and resources without ownership metadata', () => {
    const result = render(
      <ManagerDiff
        object={{
          ...object,
          metadata: {
            ...object.metadata,
            managedFields: [
              { manager: 'controller', operation: 'Update', fieldsV1: { 'f:spec': {} } },
            ],
          },
        }}
      />
    );
    expect(screen.getByText('Manager-owned fields')).toBeTruthy();
    expect(screen.getByText(/selection includes Update operations/)).toBeTruthy();
    result.rerender(<ManagerDiff object={{ ...object, metadata: { name: 'no-ownership' } }} />);
    expect(screen.getByText(/No field ownership is recorded/)).toBeTruthy();
    expect(screen.queryByLabelText('SSA field ownership diff')).toBeNull();
  });
});

describe('global resource inspection', () => {
  it('loads only on demand, pins the resource cluster, and masks Secrets in both views', async () => {
    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: 'credentials',
        namespace: 'team',
        uid: 'secret',
        managedFields: [
          { manager: 'secret-operator', operation: 'Apply', fieldsV1: { 'f:data': {} } },
        ],
      },
      data: { password: 'live-secret-value' },
    };
    load.mockResolvedValue(secret);
    render(
      <SSAAction
        resource={{
          jsonData: { ...secret, data: { password: 'cached-secret-value' } },
          cluster: 'resource-cluster',
        }}
      />
    );
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'SSA Inspector' }));
    await screen.findByText('Secret contents are hidden.');
    expect(load.mock.calls[0][0]).toMatchObject({
      cluster: 'resource-cluster',
      uid: 'secret',
      name: 'credentials',
    });
    expect(screen.queryByText(/live-secret-value|cached-secret-value/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Live YAML' }));
    expect(screen.queryByText(/live-secret-value/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Reveal Secret values in diff / YAML'));
    expect(screen.getByLabelText('Live resource YAML').textContent).toContain('live-secret-value');
    fireEvent.click(screen.getByRole('tab', { name: 'SSA / field ownership' }));
    expect(screen.getByText('password: "live-secret-value"')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Reveal Secret values in diff / YAML'));
    expect(screen.queryByText(/live-secret-value/)).toBeNull();
    const requestSignal = load.mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(requestSignal.aborted).toBe(true));
  });
  it('reports read errors and allows a fresh retry', async () => {
    load
      .mockRejectedValueOnce(new Error('Forbidden: resource is not readable'))
      .mockResolvedValueOnce(object);
    render(
      <SSAResourceDialog
        identity={{
          apiVersion: object.apiVersion,
          kind: object.kind,
          name: 'alice',
          namespace: 'team',
          uid: 'one',
          cluster: 'cluster',
        }}
        onClose={() => {}}
      />
    );
    await screen.findByText('Forbidden: resource is not readable');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh object' }));
    await screen.findByLabelText('SSA field ownership diff');
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('resets Secret reveal and ignores an old response after switching resources', async () => {
    const identity = {
      apiVersion: 'v1',
      kind: 'Secret',
      name: 'first',
      namespace: 'team',
      uid: 'first',
      cluster: 'cluster-a',
    };
    const secret = (name: string) => ({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        uid: name,
        managedFields: [{ manager: 'controller', operation: 'Apply', fieldsV1: { 'f:data': {} } }],
      },
      data: { password: `${name}-private` },
    });
    let resolveOld: (value: any) => void;
    load
      .mockResolvedValueOnce(secret('first'))
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce(secret('second'));
    const result = render(<SSAResourceDialog identity={identity} onClose={() => {}} />);
    await screen.findByText('Secret contents are hidden.');
    fireEvent.click(screen.getByLabelText('Reveal Secret values in diff / YAML'));
    expect(screen.getByText('password: "first-private"')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh object' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    const oldSignal = load.mock.calls[1][1];
    result.rerender(
      <SSAResourceDialog
        identity={{ ...identity, name: 'second', uid: 'second', cluster: 'cluster-b' }}
        onClose={() => {}}
      />
    );
    await screen.findByText('Secret contents are hidden.');
    expect(oldSignal.aborted).toBe(true);
    resolveOld(secret('first'));
    await waitFor(() => expect(screen.queryByText(/first-private|second-private/)).toBeNull());
    expect(
      (screen.getByLabelText('Reveal Secret values in diff / YAML') as HTMLInputElement).checked
    ).toBe(false);
  });
});
