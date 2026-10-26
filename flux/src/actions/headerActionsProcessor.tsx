import { Icon } from '@iconify/react';
import {
  registerDetailsViewHeaderActionsProcessor,
  useTranslation,
} from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/KubeObject';
import { Box, Tooltip } from '@mui/material';
import { capability } from './model';
import { ResourceActions } from './ResourceActions';

const FLUX_OWNERSHIP_LABELS = ['kustomize.toolkit.fluxcd.io/name', 'helm.toolkit.fluxcd.io/name'];
const FLUX_MANAGED_ACTION_ID = 'flux-managed-indicator';
const FLUX_RESOURCE_ACTIONS_ID = 'flux-resource-actions';

function isManagedByFlux(resource: KubeObject): boolean {
  const labels = resource.jsonData?.metadata?.labels;
  return FLUX_OWNERSHIP_LABELS.some(label => !!labels?.[label]);
}

function FluxManagedIndicator() {
  const { t } = useTranslation();
  return (
    <Tooltip title={t('Managed by Flux')}>
      <Box
        component="span"
        role="img"
        aria-label={t('Managed by Flux')}
        sx={{ display: 'inline-flex', alignItems: 'center', color: 'primary.main', mx: 1 }}
      >
        <Icon icon="simple-icons:flux" width={20} />
      </Box>
    </Tooltip>
  );
}

export function registerFluxHeaderActionsProcessor() {
  registerDetailsViewHeaderActionsProcessor((resource, headerActions) => {
    if (!resource) return headerActions;
    let actions = headerActions;
    if (capability(resource)) {
      actions = [
        ...actions.filter(action => action.id !== FLUX_RESOURCE_ACTIONS_ID),
        { id: FLUX_RESOURCE_ACTIONS_ID, action: <ResourceActions resource={resource} /> },
      ];
    }
    if (isManagedByFlux(resource)) {
      actions = [
        ...actions.filter(action => action.id !== FLUX_MANAGED_ACTION_ID),
        { id: FLUX_MANAGED_ACTION_ID, action: <FluxManagedIndicator /> },
      ];
    }
    return actions;
  });
}
