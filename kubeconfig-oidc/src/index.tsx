import React from 'react';
import { registerAppBarAction, registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { Tooltip, IconButton } from '@mui/material';
import { Icon } from '@iconify/react';
import * as ReactRouter from 'react-router-dom';

import { KubeconfigPage } from './KubeconfigPage';

export const PLUGIN_ID = 'headlamp-kubeconfig-oidc';
export const KUBECONFIG_ROUTE_PATH = '/kubeconfig-oidc';

function useNavigateCompat(): (path: string) => void {
  const anyRouter = ReactRouter as any;

  if (typeof anyRouter.useNavigate === 'function') {
    const navigate = anyRouter.useNavigate();
    return (path: string) => navigate(path);
  }

  if (typeof anyRouter.useHistory === 'function') {
    const history = anyRouter.useHistory();
    return (path: string) => history.push(path);
  }

  return (path: string) => {
    window.location.href = path;
  };
}

function KubeconfigAppBarButton() {
  const go = useNavigateCompat();

  return (
    <Tooltip title="Kubeconfig (OIDC)">
      <IconButton aria-label="kubeconfig-oidc" size="large" onClick={() => go(KUBECONFIG_ROUTE_PATH)}>
        <Icon icon="mdi:kubernetes" width="22" height="22" />
      </IconButton>
    </Tooltip>
  );
}

registerRoute({
  path: KUBECONFIG_ROUTE_PATH,
  component: () => <KubeconfigPage />,
});

// Optional: also add it in the sidebar under Settings
registerSidebarEntry({
  parent: 'settings',
  name: 'kubeconfig-oidc',
  label: 'Kubeconfig',
  url: KUBECONFIG_ROUTE_PATH,
});

registerAppBarAction(KubeconfigAppBarButton);
