import {
  registerAppBarAction,
  registerPluginSettings,
  registerRoute,
} from '@kinvolk/headlamp-plugin/lib';
import { KubeconfigButton } from './KubeconfigButton';
import { KubeconfigSettings } from './KubeconfigSettings';
import { ShellOidcReturn } from './local';

registerAppBarAction(KubeconfigButton);
registerPluginSettings('buttah-kubeconfig', KubeconfigSettings, false);

registerRoute({
  path: '/buttah/shell-oidc',
  sidebar: null,
  name: 'buttah-shell-oidc',
  exact: true,
  isFullWidth: true,
  useClusterURL: false,
  noAuthRequired: true,
  component: ShellOidcReturn,
});
