import { registerDetailsViewHeaderActionsProcessor } from '@kinvolk/headlamp-plugin/lib';
import { identityKey, resourceIdentity } from './api';
import { SSAAction } from './ResourceInspector';

export const ACTION_ID = 'ssa-inspector';
export function addSSAAction(resource: any, actions: { id: string; action?: any }[]) {
  const identity = resourceIdentity(resource, resource?.cluster || 'current-cluster');
  if (!identity || actions.some(action => action.id === ACTION_ID)) return actions;
  return [
    ...actions,
    { id: ACTION_ID, action: <SSAAction key={identityKey(identity)} resource={resource} /> },
  ];
}

registerDetailsViewHeaderActionsProcessor({ id: ACTION_ID, processor: addSSAAction });
