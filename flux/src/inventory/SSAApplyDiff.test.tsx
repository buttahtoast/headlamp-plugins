import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { resolveInventory } = vi.hoisted(() => ({ resolveInventory: vi.fn() }));
vi.mock('./api', () => ({ resolveInventory }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { ResourceClasses: {} },
  useTranslation: () => ({ t: (value: string) => value }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('../common/Table', () => ({ default: () => null }));
vi.mock('../actions/ResourceActions', () => ({ ResourceActions: () => null }));
import { ObjectInspector } from './InventoryPanel';
import { InventoryRecord } from './model';
import { SSAApplyDiff } from './SSAApplyDiff';

afterEach(cleanup);
beforeEach(() => {
  resolveInventory.mockReset();
});
const object = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: {
    name: 'settings',
    namespace: 'apps',
    managedFields: [
      {
        manager: 'kustomize-controller',
        operation: 'Apply',
        fieldsV1: { 'f:data': { 'f:flux': {} } },
      },
      { manager: 'kubectl', operation: 'Apply', fieldsV1: { 'f:data': { 'f:manual': {} } } },
    ],
  },
  data: { flux: 'generated', manual: 'keep' },
};
describe('inventory SSA apply diff', () => {
  it('highlights Flux-owned fields and preserves unowned live context', () => {
    render(<SSAApplyDiff object={object} ownerKind="Kustomization" />);
    const diff = screen.getByLabelText('SSA field ownership diff');
    expect(
      within(diff).getByText('flux: "generated"').parentElement.getAttribute('data-managed')
    ).toBe('true');
    expect(
      within(diff).getByText('manual: "keep"').parentElement.getAttribute('data-managed')
    ).toBeNull();
  });
  it('identifies Helm Update ownership without presenting it as SSA Apply', () => {
    render(
      <SSAApplyDiff
        object={{
          ...object,
          metadata: {
            ...object.metadata,
            managedFields: [{ manager: 'helm', operation: 'Update', fieldsV1: { 'f:data': {} } }],
          },
        }}
        ownerKind="HelmRelease"
      />
    );
    expect(screen.getByText(/selection includes Update operations/)).toBeTruthy();
    expect(screen.getByText('Manager-owned fields')).toBeTruthy();
    expect(screen.getByLabelText('SSA field ownership diff')).toBeTruthy();
  });
  it('fetches live ownership in the selected cluster and hides Secret values in both views until revealed', async () => {
    const secret = {
      ...object,
      kind: 'Secret',
      metadata: {
        ...object.metadata,
        managedFields: [
          { manager: 'kustomize-controller', operation: 'Apply', fieldsV1: { 'f:data': {} } },
        ],
      },
      data: { password: 'test-secret-value' },
    };
    const record: InventoryRecord = {
      id: 'secret',
      kind: 'Secret',
      name: 'settings',
      namespace: 'apps',
      version: 'v1',
      group: '',
      state: 'loaded',
      object: secret,
    };
    resolveInventory.mockImplementation(async (_cluster, _refs, onRecord) =>
      onRecord({ ...record, object: secret })
    );
    render(
      <ObjectInspector
        record={record}
        cluster="explicit-cluster"
        ownerKind="Kustomization"
        onClose={() => {}}
      />
    );
    await screen.findByText('Secret contents are hidden.');
    expect(resolveInventory.mock.calls[0][0]).toBe('explicit-cluster');
    expect(screen.queryByText(/test-secret-value/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Live YAML' }));
    expect(screen.queryByText(/test-secret-value/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'SSA apply diff' }));
    fireEvent.click(screen.getByLabelText('Reveal Secret values in diff / YAML'));
    expect(screen.getByText('password: "test-secret-value"')).toBeTruthy();
  });
});
