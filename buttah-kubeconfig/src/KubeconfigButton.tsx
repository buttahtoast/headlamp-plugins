import { K8s } from '@kinvolk/headlamp-plugin/lib';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useEffect, useRef, useState } from 'react';
import {
  assertIdTokenClaims,
  clearPending,
  contextNamespaceChoice,
  createOidcAttempt,
  currentClusterConfig,
  currentRedirectUri,
  ensureClusterConfig,
  exchangeCodeForIdToken,
  isDnsLabel,
  kubeconfigDocument,
  type KubeconfigFile,
  loadClusterCa,
  OIDC_UNCONFIGURED,
  oidcReady,
  prepareShellLogin,
  readPrefs,
  registerKubeconfigAccess,
  resolveOidcEndpoints,
  shellIdentityAvailable,
  type ShellLogin,
  storePending,
  updateKubeconfigAccess,
  waitForOidc,
  writePrefs,
} from './local';
import plainCss from './plain.css?inline';
import { UserMenuItem } from './UserMenuItem';

type NamedNamespace = {
  metadata?: { name?: string };
  status?: { phase?: string };
};

function errorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (!error || typeof error !== 'object') {
    return '';
  }
  const record = error as { message?: unknown; body?: unknown };
  if (typeof record.message === 'string' && record.message) {
    try {
      const parsed = JSON.parse(record.message) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message) {
        return parsed.message;
      }
    } catch {
      return record.message;
    }
    return record.message;
  }
  if (typeof record.body === 'string' && record.body) {
    return record.body;
  }
  return '';
}

function errorText(error: unknown): string {
  return errorMessage(error) || 'Could not download the kubeconfig.';
}

function namespaceNames(items: NamedNamespace[] | null): string[] {
  if (!items) {
    return [];
  }
  return items
    .filter(item => item.status?.phase !== 'Terminating')
    .map(item => item.metadata?.name)
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => left.localeCompare(right));
}

export function KubeconfigButton() {
  const cluster = K8s.useCluster();
  const [listed, listError] = K8s.ResourceClasses.Namespace.useList(
    cluster ? { cluster } : undefined
  );
  const names = namespaceNames(listed as NamedNamespace[] | null);
  const [kubeFile, setKubeFile] = useState<KubeconfigFile | null>(null);
  const [kubeNamespace, setKubeNamespace] = useState('');
  const material = useRef<{ idToken: string; caPem: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const namesRef = useRef(names);
  namesRef.current = names;
  const listErrorRef = useRef(listError);
  listErrorRef.current = listError;

  useEffect(() => {
    if (
      typeof document === 'undefined' ||
      document.getElementById('buttah-cloud-styles') ||
      document.getElementById('buttah-kubeconfig-layout')
    ) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'buttah-kubeconfig-layout';
    style.textContent = plainCss;
    document.head.appendChild(style);
  }, []);

  async function download() {
    if (!cluster || busy) {
      return;
    }
    const popup = window.open('', 'buttah-kubeconfig-oidc', 'popup,width=480,height=720');
    setBusy(true);
    updateKubeconfigAccess({ phase: 'busy', error: null });
    setKubeFile(null);
    try {
      await ensureClusterConfig();
      const current = readPrefs();
      const config = currentClusterConfig();
      if (!oidcReady(config) || !shellIdentityAvailable(current.shell)) {
        popup?.close();
        updateKubeconfigAccess({ phase: 'error', error: OIDC_UNCONFIGURED });
        return;
      }
      if (!config.values.kubeconfig.server?.trim()) {
        popup?.close();
        updateKubeconfigAccess({
          phase: 'error',
          error: 'The cluster config does not set kubeconfig.server.',
        });
        return;
      }
      const contextNamespace = contextNamespaceChoice({
        pathname: window.location.pathname,
        cluster,
        knownNamespaces: namesRef.current,
        stored: current.contextNamespace,
        configDefault: config.values.kubeconfig.contextNamespace ?? '',
      });
      const namespace = current.shell.namespace || contextNamespace;
      if (!namespace) {
        popup?.close();
        updateKubeconfigAccess({
          phase: 'error',
          error: 'Choose a namespace. The sign-in pod needs one, and shell.namespace is empty.',
        });
        return;
      }
      const redirectUri = currentRedirectUri();
      const prepared = prepareShellLogin({
        shell: current.shell,
        namespace,
        redirectUri,
        endpoints: {
          authorizationEndpoint: current.shell.authorizationEndpoint,
          tokenEndpoint: current.shell.tokenEndpoint,
          browserDiscovery: false,
        },
        fallbackImage: '',
      });
      const endpoints = await resolveOidcEndpoints(current.shell);
      const attempt = await createOidcAttempt({
        authorizationEndpoint: endpoints.authorizationEndpoint,
        clientId: prepared.clientId,
        redirectUri,
        scopes: prepared.scopes,
      });
      const pending = {
        state: attempt.state,
        nonce: attempt.nonce,
        verifier: attempt.verifier,
        redirectUri,
        namespace,
        cluster,
        returnUrl: window.location.href,
        issuerUrl: prepared.issuerUrl,
        clientId: prepared.clientId,
        scopes: prepared.scopes,
        tokenEndpoint: endpoints.tokenEndpoint,
        authorizationEndpoint: endpoints.authorizationEndpoint,
        idpCaPem: prepared.idpCaPem,
        image: prepared.image,
        browserExchange: false,
        createdAt: Date.now(),
      };
      let signIn = popup && !popup.closed ? popup : null;
      if (!signIn) {
        signIn = window.open(attempt.url, 'buttah-kubeconfig-oidc', 'popup,width=480,height=720');
      } else {
        signIn.location.href = attempt.url;
      }
      if (!signIn || signIn.closed) {
        throw new Error('The browser blocked the identity provider window.');
      }
      storePending(pending);
      const code = await waitForOidc(pending, signIn);
      signIn.close();
      clearPending();
      const login: ShellLogin = {
        issuerUrl: pending.issuerUrl,
        clientId: pending.clientId,
        scopes: pending.scopes,
        redirectUri: pending.redirectUri,
        tokenEndpoint: pending.tokenEndpoint,
        code,
        verifier: pending.verifier,
        nonce: pending.nonce,
        idToken: '',
        refreshToken: '',
        idpCaPem: pending.idpCaPem,
        namespace,
      };
      const idToken = await exchangeCodeForIdToken(cluster, namespace, login, prepared.image);
      assertIdTokenClaims(idToken, {
        issuer: pending.issuerUrl,
        audience: pending.clientId,
        nonce: pending.nonce,
      });
      const certificateAuthorityPem = await loadClusterCa(
        cluster,
        config.values.kubeconfig.certificateAuthorityData,
        config.values.kubeconfig.server ?? ''
      );
      const chosen = contextNamespace || 'default';
      material.current = { idToken, caPem: certificateAuthorityPem };
      setKubeNamespace(chosen);
      if (isDnsLabel(chosen)) {
        writePrefs({ contextNamespace: chosen });
      }
      setKubeFile(
        kubeconfigDocument({
          settings: { ...config.values.kubeconfig, contextNamespace: chosen },
          clusterFallbackName: cluster,
          namespaceFallback: chosen,
          certificateAuthorityPem,
          idToken,
        })
      );
      updateKubeconfigAccess({ phase: 'file', error: null });
    } catch (error) {
      popup?.close();
      clearPending();
      updateKubeconfigAccess({ phase: 'error', error: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  const downloadRef = useRef(download);
  downloadRef.current = download;

  useEffect(() => {
    return registerKubeconfigAccess({
      start: () => {
        void downloadRef.current();
      },
      phase: 'idle',
      error: null,
    });
  }, []);

  const server = kubeFile?.yaml.match(/^\s*server:\s*'?([^'\n]+)'?/m)?.[1] ?? '';
  const contextNamespace = kubeFile?.yaml.match(/^\s*namespace:\s*'?([^'\n]+)'?/m)?.[1] ?? '';

  return (
    <>
      <UserMenuItem
        id="buttah-download-kubeconfig"
        label="Kubeconfig"
        disabled={!cluster || busy}
        onSelect={() => {
          void download();
        }}
      />
      <Dialog
        open={Boolean(kubeFile)}
        onClose={() => {
          setKubeFile(null);
          updateKubeconfigAccess({ phase: 'idle', error: null });
        }}
        fullWidth
        maxWidth="md"
        aria-labelledby="buttah-kubeconfig-title"
      >
        <DialogTitle id="buttah-kubeconfig-title">Kubeconfig</DialogTitle>
        <DialogContent>
          {kubeFile ? (
            <>
              <dl className="buttah-kubeconfig-meta">
                <dt>User</dt>
                <dd id="buttah-kubeconfig-expiry">{kubeFile.identity.userName}</dd>
                <dt>Expires</dt>
                <dd>{kubeFile.identity.expiresAt.toISOString()}</dd>
                <dt>Server</dt>
                <dd>{server}</dd>
                <dt>Namespace</dt>
                <dd>{contextNamespace || kubeNamespace}</dd>
              </dl>
              <textarea
                id="buttah-kubeconfig-preview"
                className="buttah-kubeconfig-preview"
                readOnly
                value={kubeFile.yaml}
                spellCheck={false}
              />
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setKubeFile(null);
              updateKubeconfigAccess({ phase: 'idle', error: null });
            }}
            color="inherit"
          >
            Close
          </Button>
          <Button
            id="buttah-kubeconfig-copy"
            onClick={() => {
              if (!kubeFile) {
                return;
              }
              const preview = document.getElementById('buttah-kubeconfig-preview');
              if (preview instanceof HTMLTextAreaElement) {
                preview.focus();
                preview.select();
              }
              void navigator.clipboard?.writeText(kubeFile.yaml);
            }}
          >
            Copy
          </Button>
          <Button
            id="buttah-kubeconfig-download"
            variant="contained"
            onClick={() => {
              if (!kubeFile) {
                return;
              }
              const blob = new Blob([kubeFile.yaml], { type: 'text/yaml' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = kubeFile.fileName;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
