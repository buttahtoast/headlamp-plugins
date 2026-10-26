import { useSyncExternalStore } from 'react';
import { ResourceData } from '../common/health';
import { ActionDefinition, ResourceRef } from './model';

export interface ActionTarget {
  ref: ResourceRef;
  object: ResourceData;
}
export interface ActionSession {
  id: number;
  targets: ActionTarget[];
  action: ActionDefinition;
}
let sequence = 0;
let state: { session?: ActionSession; busy: boolean; open: boolean } = { busy: false, open: false };
const listeners = new Set<() => void>();
export function updateSession(change: Partial<typeof state>) {
  state = { ...state, ...change };
  listeners.forEach(listener => listener());
}
export function launchAction(targets: ActionTarget[], action: ActionDefinition) {
  if (state.busy) {
    updateSession({ open: true });
    return;
  }
  updateSession({ session: { id: ++sequence, targets, action }, open: true, busy: false });
}
export function useActionSession() {
  return useSyncExternalStore(
    callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => state
  );
}
