import { ManagedFieldSelection } from 'ssa-inspector/model';
export { buildSSAFieldLines, managerKey, mergeSSAFields } from 'ssa-inspector/model';
export type { SSAFieldLine, ManagedFieldSelection } from 'ssa-inspector/model';

export function isFluxManager(manager: string | undefined, ownerKind: string): boolean {
  return (
    ownerKind === 'HelmRelease' ? ['helm-controller', 'helm'] : ['kustomize-controller']
  ).includes(manager || '');
}

/** Never choose an unrelated apply manager or a status-subresource entry as Flux's apply. */
export function selectFluxManagedFields(
  managedFields: ManagedFieldSelection[],
  ownerKind: string
): ManagedFieldSelection[] {
  return managedFields.filter(
    field =>
      field.operation === 'Apply' &&
      !field.subresource &&
      field.fieldsV1 &&
      Object.keys(field.fieldsV1).length > 0 &&
      isFluxManager(field.manager, ownerKind)
  );
}
