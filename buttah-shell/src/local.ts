/** In-plugin barrel. Not a package other plugins can import. */
export {
  ACCESS_EVENT,
  type KubeconfigAccess,
  type KubeconfigPhase,
  readAccess,
  registerKubeconfigAccess,
  registerShellPresence,
  updateKubeconfigAccess,
} from './access';
export {
  type ClusterConfig,
  fieldNote,
  type FieldSource,
  isDnsLabel,
  oidcReady,
  type PrefKey,
} from './clusterConfig';
export { currentClusterConfig, ensureClusterConfig, readPrefs, writePrefs } from './prefs';
export {
  assertIdTokenClaims,
  clearPending,
  clearStoredResult,
  createOidcAttempt,
  currentRedirectUri,
  decodeExecFrame,
  deliveryFailure,
  deliveryOutcome,
  encodeDelivery,
  encodeExecStdin,
  exchangeAuthorizationCode,
  headlampAuthType,
  headlampOidcClusterNames,
  OIDC_UNCONFIGURED,
  type OidcPending,
  prepareShellLogin,
  readStoredPending,
  readStoredResult,
  resolveOidcEndpoints,
  type ShellLogin,
  SHELL_DELIVER,
  shellIdentityAvailable,
  shellIdentityNote,
  shellRequestEnv,
  storePending,
  takeOidcCode,
} from './oidc';
export { waitForOidc } from './oidcWait';
export { tokenIdentity } from './kubeconfig';
export type { ShellPrefs } from './types';
export {
  SHELL_CONTAINER,
  SHELL_IMAGE,
  type ShellStatus,
  shellPod,
  shellPodName,
  shellRunning,
  shellWait,
} from './shellPod';
export { SettingsField } from './SettingsField';
export { ShellOidcReturn } from './ShellOidcReturn';
export { useButtahPrefs } from './usePrefs';
