/** In-plugin barrel. Not a package other plugins can import. */
export {
  ACCESS_EVENT,
  readAccess,
  registerKubeconfigAccess,
  updateKubeconfigAccess,
} from './access';
export {
  clusterCaFieldText,
  contextNamespaceChoice,
  type KubeconfigFile,
  kubeconfigDocument,
} from './kubeconfig';
export {
  assertIdTokenClaims,
  clearPending,
  createOidcAttempt,
  currentRedirectUri,
  OIDC_UNCONFIGURED,
  prepareShellLogin,
  resolveOidcEndpoints,
  type ShellLogin,
  shellIdentityAvailable,
  storePending,
} from './oidc';
export { waitForOidc } from './oidcWait';
export { fieldNote, type FieldSource, isDnsLabel, oidcReady } from './clusterConfig';
export { currentClusterConfig, ensureClusterConfig, readPrefs, writePrefs } from './prefs';

export { exchangeCodeForIdToken, loadClusterCa } from './tokenExchange';
export { SettingsField } from './SettingsField';
export { ShellOidcReturn } from './ShellOidcReturn';
export { useButtahPrefs } from './usePrefs';
