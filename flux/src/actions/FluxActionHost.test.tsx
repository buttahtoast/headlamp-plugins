import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./client', () => ({ actionClient: { get } }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  EditorDialog: ({ item, onSave }: any) =>
    item ? (
      <div>
        <output data-testid="editor-interval">{item.spec.interval}</output>
        <button onClick={() => onSave([{ ...item, spec: { ...item.spec, interval: '5m' } }])}>
          Review changes
        </button>
      </div>
    ) : (
      <div>Loading</div>
    ),
}));
vi.mock('./MutationDialog', () => ({
  MutationDialog: ({ editOptions, onBack }: any) => (
    <div>
      <output data-testid="review-interval">{editOptions.edited.spec.interval}</output>
      <button onClick={onBack}>Back to editor</button>
    </div>
  ),
}));
import { FluxActionHost } from './FluxActionHost';
import { resourceRef } from './model';
import { launchAction, updateSession } from './session';

afterEach(() => {
  cleanup();
  updateSession({ session: undefined, open: false, busy: false });
});
describe('YAML edit review', () => {
  it('preserves the edited document when returning from patch review', async () => {
    const object = {
      apiVersion: 'source.toolkit.fluxcd.io/v1',
      kind: 'GitRepository',
      metadata: { name: 'repo', namespace: 'apps', uid: 'original' },
      spec: { interval: '1m' },
    };
    get.mockResolvedValue(object);
    launchAction([{ ref: resourceRef(object, 'cluster-b'), object }], {
      id: 'edit',
      label: 'Edit YAML',
      operation: 'edit',
      icon: 'mdi:pencil',
    });
    render(<FluxActionHost />);
    expect((await screen.findByTestId('editor-interval')).textContent).toBe('1m');
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByTestId('review-interval').textContent).toBe('5m');
    fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
    expect(screen.getByTestId('editor-interval').textContent).toBe('5m');
  });
});
