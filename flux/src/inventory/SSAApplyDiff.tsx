import { ManagerDiff } from 'ssa-inspector/viewer';
import { ResourceData } from '../common/health';

export function SSAApplyDiff({ object, ownerKind }: { object: ResourceData; ownerKind: string }) {
  return (
    <ManagerDiff
      object={object}
      preferredManagers={
        ownerKind === 'HelmRelease' ? ['helm-controller', 'helm'] : ['kustomize-controller']
      }
      preferredLabel="Flux SSA apply managers"
      allowSubresources={false}
    />
  );
}
