import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  registerDetailsViewHeaderActionsProcessor: register,
  useTranslation: () => ({ t: (text: string) => text }),
}));
vi.mock('@iconify/react', () => ({ Icon: () => <svg /> }));
vi.mock('./ResourceActions', () => ({ ResourceActions: () => <button>Flux actions</button> }));
import { registerFluxHeaderActionsProcessor } from './headerActionsProcessor';

const resource = (kind: string, label?: string) => ({
  jsonData: {
    apiVersion: kind === 'Kustomization' ? 'kustomize.toolkit.fluxcd.io/v1' : 'apps/v1',
    kind,
    metadata: {
      name: 'example',
      namespace: 'apps',
      labels: label ? { [label]: 'release' } : {},
    },
  },
});
function processor() {
  return register.mock.calls.at(-1)[0];
}
beforeEach(() => {
  register.mockClear();
  registerFluxHeaderActionsProcessor();
});
afterEach(cleanup);

describe('Flux header actions preserve resource changes', () => {
  it.each(['kustomize.toolkit.fluxcd.io/name', 'helm.toolkit.fluxcd.io/name'])(
    'keeps native actions usable for objects owned through %s, with only an ownership icon',
    label => {
      const item = resource('Deployment', label);
      const original = JSON.stringify(item);
      const handlers = ['Edit', 'Delete', 'Scale', 'Rollback'].map(name => ({
        name,
        click: vi.fn(),
      }));
      const actions = handlers.map(handler => ({
        id: handler.name.toLowerCase(),
        action: <button onClick={handler.click}>{handler.name}</button>,
      }));
      const result = processor()(item, actions);
      expect(result.slice(0, actions.length)).toEqual(actions);
      render(
        <>
          {result.map(action => (
            <span key={action.id}>{action.action}</span>
          ))}
        </>
      );
      for (const handler of handlers) {
        fireEvent.click(screen.getByRole('button', { name: handler.name }));
        expect(handler.click).toHaveBeenCalledOnce();
      }
      expect(screen.getByRole('img', { name: 'Managed by Flux' })).toBeTruthy();
      expect(screen.queryByText('Flux managed')).toBeNull();
      expect(screen.queryByRole('button', { name: 'View YAML' })).toBeNull();
      expect(JSON.stringify(item)).toBe(original);
    }
  );
  it('adds Flux operations alongside native and SSA actions without duplicating additions', () => {
    const item = resource('Kustomization', 'kustomize.toolkit.fluxcd.io/name');
    const actions = [{ id: 'edit' }, { id: 'delete' }, { id: 'ssa-inspector' }];
    const result = processor()(item, actions);
    expect(result.slice(0, actions.length)).toEqual(actions);
    expect(result.map(action => action.id)).toEqual([
      'edit',
      'delete',
      'ssa-inspector',
      'flux-resource-actions',
      'flux-managed-indicator',
    ]);
    expect(processor()(item, result).map(action => action.id)).toEqual(
      result.map(action => action.id)
    );
    expect(actions).toHaveLength(3);
  });
  it('leaves loading and unmanaged resource headers unchanged', () => {
    const actions = [{ id: 'edit' }, { id: 'delete' }];
    expect(processor()(null, actions)).toBe(actions);
    expect(processor()(resource('Deployment'), actions)).toBe(actions);
  });
});
