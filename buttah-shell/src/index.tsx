import {
  registerAppBarAction,
  registerPluginSettings,
  registerRoute,
} from '@kinvolk/headlamp-plugin/lib';
import { registerShellPresence, ShellOidcReturn } from './local';
import { ShellButton } from './ShellButton';
import { ShellSettings } from './ShellSettings';

registerShellPresence();

registerAppBarAction(ShellButton);
registerPluginSettings('buttah-shell', ShellSettings, false);

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
