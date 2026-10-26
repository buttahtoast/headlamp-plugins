import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { jsonData, ResourceData } from '../common/health';
import { actionClient } from './client';
import { actionDefinitions, capability, resourceRef } from './model';
import { ActionTarget, launchAction, updateSession, useActionSession } from './session';

export function ResourceActions({
  resource,
  resources,
  compact = false,
}: {
  resource?: ResourceData;
  resources?: ResourceData[];
  compact?: boolean;
}) {
  const cluster = K8s.useCluster();
  const { busy } = useActionSession();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [permissions, setPermissions] = useState<{ patch: boolean; delete: boolean }>();
  const targets: ActionTarget[] = useMemo(
    () =>
      (resources || (resource ? [resource] : []))
        .filter(item => !!capability(item))
        .flatMap(item => {
          try {
            return [
              {
                ref: resourceRef(item, item.cluster || cluster || ''),
                object: JSON.parse(JSON.stringify(jsonData(item))),
              },
            ];
          } catch {
            return [];
          }
        }),
    [resource, resources, cluster]
  );
  const signature = targets
    .map(
      target => `${target.ref.cluster}/${target.ref.uid}/${target.object.metadata?.resourceVersion}`
    )
    .join('|');
  useEffect(() => {
    setPermissions(undefined);
    if (!anchor || targets.length !== 1) return;
    const abort = new AbortController();
    Promise.all([
      actionClient.allowed(targets[0].ref, 'patch', abort.signal),
      actionClient.allowed(targets[0].ref, 'delete', abort.signal),
    ]).then(
      ([patch, remove]) => !abort.signal.aborted && setPermissions({ patch, delete: remove })
    );
    return () => abort.abort();
  }, [anchor, signature]);
  if (!targets.length) return null;
  const actions = actionDefinitions(targets[0].object).filter(
    action =>
      targets.every(target =>
        actionDefinitions(target.object).some(other => other.id === action.id)
      ) && !(targets.length > 1 && action.id === 'edit')
  );
  return (
    <>
      {compact ? (
        <Tooltip title="Flux resource actions">
          <IconButton
            size="small"
            aria-label={`Flux actions for ${targets[0].ref.name}`}
            onClick={event => {
              event.stopPropagation();
              busy ? updateSession({ open: true }) : setAnchor(event.currentTarget);
            }}
          >
            <Icon icon="mdi:dots-vertical" />
          </IconButton>
        </Tooltip>
      ) : (
        <Button
          variant="outlined"
          size="small"
          startIcon={<Icon icon="mdi:lightning-bolt-outline" />}
          onClick={event => (busy ? updateSession({ open: true }) : setAnchor(event.currentTarget))}
        >
          {targets.length > 1 ? `Actions (${targets.length})` : 'Actions'}
        </Button>
      )}
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        onClick={event => event.stopPropagation()}
      >
        {actions.map(action => {
          let reason = '';
          if (action.operation && targets.length === 1 && !permissions)
            reason = 'Checking permissions…';
          if (
            action.operation &&
            permissions &&
            !(action.operation === 'delete' ? permissions.delete : permissions.patch)
          )
            reason = 'Your Kubernetes permissions do not allow this action.';
          if (
            action.operation === 'reconcile' &&
            targets.some(target => target.object.spec?.suspend)
          )
            reason = 'Resume suspended resources first.';
          if (
            action.operation === 'suspend' &&
            targets.every(target => target.object.spec?.suspend)
          )
            reason = 'Already suspended.';
          if (
            action.operation === 'resume' &&
            targets.every(target => !target.object.spec?.suspend)
          )
            reason = 'Already active.';
          return (
            <MenuItem
              key={action.id}
              disabled={!!reason}
              onClick={() => {
                setAnchor(null);
                launchAction(targets, action);
              }}
              title={reason}
            >
              <ListItemIcon>
                <Icon icon={action.icon} width={20} />
              </ListItemIcon>
              <ListItemText primary={action.label} secondary={reason || undefined} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
