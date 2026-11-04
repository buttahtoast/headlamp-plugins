import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import Portal from '@mui/material/Portal';
import { useEffect, useRef, useState } from 'react';
import { installShellFont, installShellLayout } from './layout';
import {
  assertIdTokenClaims,
  clearPending,
  clearStoredResult,
  createOidcAttempt,
  currentClusterConfig,
  currentRedirectUri,
  ensureClusterConfig,
  exchangeAuthorizationCode,
  headlampAuthType,
  OIDC_UNCONFIGURED,
  type OidcPending,
  oidcReady,
  prepareShellLogin,
  readPrefs,
  readStoredPending,
  readStoredResult,
  resolveOidcEndpoints,
  SHELL_IMAGE,
  shellIdentityAvailable,
  shellIdentityNote,
  type ShellLogin,
  shellPod,
  shellPodName,
  type ShellPrefs,
  shellRunning,
  type ShellStatus,
  shellWait,
  storePending,
  takeOidcCode,
  useButtahPrefs,
  waitForOidc,
} from './local';
import { NamespacePalette } from './NamespacePalette';
import { deliverShellLogin } from './shellDeliver';
import { ShellDock, type ShellSession } from './ShellDock';
import { identityFromIdToken, type ShellChrome } from './shellDock';
import { rememberShellNamespace, type ShellNamespace } from './shellPlaces';
import { focusShellTerminal } from './ShellTerminal';
import { UserMenuItem } from './UserMenuItem';

type PodApi = {
  post: (body: object, queryParams: Record<string, string>, cluster: string) => Promise<unknown>;
  delete: (
    namespace: string,
    name: string,
    params: { gracePeriodSeconds: number },
    cluster: string
  ) => Promise<unknown>;
};

type NamedNamespace = {
  metadata?: { name?: string };
  status?: { phase?: string };
};

function podApi(): PodApi {
  return K8s.ResourceClasses.Pod.apiEndpoint as unknown as PodApi;
}

function errorText(error: unknown): string {
  const message = errorMessage(error);
  return message || 'Could not start the shell.';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (!error || typeof error !== 'object') {
    return '';
  }
  const record = error as { message?: unknown; body?: unknown };
  if (typeof record.message === 'string' && record.message) {
    const parsed = parseMessage(record.message);
    return parsed || record.message;
  }
  if (typeof record.body === 'string' && record.body) {
    return parseMessage(record.body) || record.body;
  }
  return '';
}

function parseMessage(value: string): string {
  try {
    const parsed = JSON.parse(value) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // The API text is already plain.
  }
  return '';
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    work.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function namespaceChoices(items: NamedNamespace[] | null, configured: string): ShellNamespace[] {
  const fromApi = (items ?? [])
    .filter(item => item.status?.phase !== 'Terminating')
    .map(item => ({
      name: item.metadata?.name || '',
      phase: item.status?.phase || '',
    }))
    .filter(item => item.name)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (configured && !fromApi.some(item => item.name === configured)) {
    return [{ name: configured, phase: '' }, ...fromApi];
  }
  return fromApi;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

async function waitUntilRunning(cluster: string, namespace: string, name: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const pod = (await ApiProxy.clusterRequest(`/api/v1/namespaces/${namespace}/pods/${name}`, {
      cluster,
    })) as { status?: ShellStatus };
    if (shellRunning(pod?.status)) {
      return;
    }
    const phase = pod?.status?.phase;
    if (phase === 'Failed' || phase === 'Succeeded') {
      throw new Error(shellWait(pod?.status));
    }
    await sleep(500);
  }
  throw new Error('The shell pod did not start.');
}

export function ShellButton() {
  const cluster = K8s.useCluster();
  const clusters = K8s.useClustersConf();
  const headlampOidc = headlampAuthType(cluster ? clusters?.[cluster] : undefined);
  const [prefs] = useButtahPrefs();
  const oidc = shellIdentityAvailable(prefs.shell);
  const [listed, listError] = K8s.ResourceClasses.Namespace.useList(
    cluster ? { cluster } : undefined
  );
  const [ask, setAsk] = useState(false);
  const [namespace, setNamespace] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ShellSession[]>([]);
  const [active, setActive] = useState(0);
  const [chrome, setChrome] = useState<ShellChrome>('open');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const namespaces = namespaceChoices(listed as NamedNamespace[] | null, prefs.shell.namespace);
  const reading = listed === null && !listError;
  const resumeStarted = useRef(false);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const accessReady = oidcReady(currentClusterConfig()) && shellIdentityAvailable(prefs.shell);

  useEffect(() => {
    installShellFont();
    installShellLayout();
  }, []);

  useEffect(() => {
    if (ask && !namespace && prefs.shell.namespace) {
      setNamespace(prefs.shell.namespace);
    }
  }, [ask, namespace, prefs.shell.namespace]);

  async function createPod(
    targetNamespace: string,
    identity: ShellSession['identity'],
    image?: string
  ): Promise<string> {
    const name = shellPodName();
    await withTimeout(
      podApi().post(
        shellPod(targetNamespace, name, {
          identity,
          image: identity === 'oidc' ? image : undefined,
        }),
        {},
        cluster ?? ''
      ),
      20_000,
      'Creating the shell pod timed out. Check that the Headlamp service account can create pods in this namespace.'
    );
    return name;
  }

  async function startOidc(
    targetNamespace: string,
    shell: ShellPrefs,
    existing?: OidcPending,
    code?: string,
    popupWindow?: Window | null
  ) {
    if (!cluster) {
      return;
    }
    const redirectUri = currentRedirectUri();
    let pending = existing;
    let authorizationCode = code;
    if (!pending || !authorizationCode) {
      setStatus('Contacting the identity provider…');
      const prepared = prepareShellLogin({
        shell,
        namespace: targetNamespace,
        redirectUri,
        endpoints: {
          authorizationEndpoint: shell.authorizationEndpoint,
          tokenEndpoint: shell.tokenEndpoint,
          browserDiscovery: false,
        },
        fallbackImage: SHELL_IMAGE,
      });
      const endpoints = await resolveOidcEndpoints(shell);
      const attempt = await createOidcAttempt({
        authorizationEndpoint: endpoints.authorizationEndpoint,
        clientId: prepared.clientId,
        redirectUri,
        scopes: prepared.scopes,
      });
      pending = {
        state: attempt.state,
        nonce: attempt.nonce,
        verifier: attempt.verifier,
        redirectUri,
        namespace: targetNamespace,
        cluster,
        returnUrl: window.location.href,
        issuerUrl: prepared.issuerUrl,
        clientId: prepared.clientId,
        scopes: prepared.scopes,
        tokenEndpoint: endpoints.tokenEndpoint,
        authorizationEndpoint: endpoints.authorizationEndpoint,
        idpCaPem: prepared.idpCaPem,
        image: prepared.image,
        browserExchange: endpoints.browserDiscovery && Boolean(endpoints.tokenEndpoint),
        createdAt: Date.now(),
      };
      storePending(pending);
      setStatus('Waiting for sign-in…');
      let popup = popupWindow && !popupWindow.closed ? popupWindow : null;
      if (!popup) {
        popup = window.open(attempt.url, 'buttah-shell-oidc', 'popup,width=480,height=720');
      } else {
        popup.location.href = attempt.url;
      }
      if (!popup || popup.closed) {
        window.location.assign(attempt.url);
        return;
      }
      authorizationCode = await waitForOidc(pending, popup);
    }
    clearPending();
    let login: ShellLogin = {
      issuerUrl: pending.issuerUrl,
      clientId: pending.clientId,
      scopes: pending.scopes,
      redirectUri: pending.redirectUri,
      tokenEndpoint: pending.tokenEndpoint,
      code: authorizationCode,
      verifier: pending.verifier,
      nonce: pending.nonce,
      idToken: '',
      refreshToken: '',
      idpCaPem: pending.idpCaPem,
      namespace: pending.namespace,
    };
    if (pending.browserExchange && pending.tokenEndpoint) {
      setStatus('Requesting a token…');
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: pending.tokenEndpoint,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        code: authorizationCode,
        verifier: pending.verifier,
      });
      assertIdTokenClaims(tokens.idToken, {
        issuer: pending.issuerUrl,
        audience: pending.clientId,
        nonce: pending.nonce,
      });
      login = {
        ...login,
        code: '',
        verifier: '',
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
      };
    }
    setStatus('Starting the shell…');
    const name = await createPod(pending.namespace, 'oidc', pending.image);
    try {
      await waitUntilRunning(cluster, pending.namespace, name);
      setStatus('Applying your identity…');
      await deliverShellLogin(cluster, pending.namespace, name, login);
    } catch (error) {
      await podApi()
        .delete(pending.namespace, name, { gracePeriodSeconds: 1 }, cluster)
        .catch(() => undefined);
      throw error;
    }
    setChrome('open');
    const created: ShellSession = {
      namespace: pending.namespace,
      name,
      identity: 'oidc',
      user: identityFromIdToken(login.idToken),
    };
    const next = [...sessionsRef.current, created];
    sessionsRef.current = next;
    setSessions(next);
    setActive(next.length - 1);
    rememberShellNamespace(created.namespace);
    setAsk(false);
    setStatus(null);
  }

  async function start(chosen?: string) {
    if (!cluster || starting) {
      return;
    }
    const popup = shellIdentityAvailable(prefs.shell)
      ? window.open('', 'buttah-shell-oidc', 'popup,width=480,height=720')
      : null;
    setStarting(true);
    setStartError(null);
    setStatus(null);
    try {
      await ensureClusterConfig();
      const current = readPrefs();
      const targetNamespace = chosen || namespace || current.shell.namespace;
      if (targetNamespace) {
        setNamespace(targetNamespace);
      }
      if (!targetNamespace) {
        popup?.close();
        return;
      }
      if (!shellIdentityAvailable(current.shell) || !oidcReady(currentClusterConfig())) {
        popup?.close();
        setStartError(OIDC_UNCONFIGURED);
        return;
      }
      await startOidc(targetNamespace, current.shell, undefined, undefined, popup);
    } catch (error) {
      popup?.close();
      clearPending();
      setAsk(false);
      setStatus(null);
      setStartError(errorText(error));
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!cluster || resumeStarted.current || sessionsRef.current.length > 0) {
      return;
    }
    const pending = readStoredPending();
    const result = readStoredResult();
    if (!pending || !result || pending.cluster !== cluster) {
      return;
    }
    resumeStarted.current = true;
    setStarting(true);
    setAsk(true);
    setNamespace(pending.namespace);
    void (async () => {
      try {
        const code = takeOidcCode(pending, result);
        clearStoredResult();
        await ensureClusterConfig();
        await startOidc(pending.namespace, readPrefs().shell, pending, code);
      } catch (error) {
        clearPending();
        clearStoredResult();
        setAsk(false);
        setStatus(null);
        setStartError(errorText(error));
      } finally {
        setStarting(false);
      }
    })();
    // Resume once per mount, after a full-page redirect back from the identity provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster]);

  return (
    <>
      <UserMenuItem
        id="buttah-open-shell"
        label="Shell"
        disabled={!cluster}
        onSelect={() => {
          if (sessionsRef.current.length > 0) {
            if (chrome === 'minimized') {
              setChrome('open');
            }
            window.setTimeout(() => focusShellTerminal(), 0);
            return;
          }
          setStartError(null);
          setAsk(true);
        }}
      />
      <NamespacePalette
        open={ask}
        namespaces={namespaces}
        namespace={namespace}
        reading={reading}
        listError={listError ? errorText(listError) : null}
        startError={startError}
        status={status}
        note={shellIdentityNote(oidc, headlampOidc) || null}
        configNote={
          accessReady && currentClusterConfig().origin !== 'file' ? 'No config file.' : null
        }
        starting={starting}
        accessReady={accessReady}
        onNamespace={setNamespace}
        onClose={() => {
          if (!starting) {
            setAsk(false);
          }
        }}
        onStart={name => void start(name)}
      />
      {startError && !ask ? (
        <Portal>
          <div id="buttah-shell-start-error" className="buttah-shell-error-banner" role="alert">
            <p>{startError}</p>
            <button type="button" onClick={() => setStartError(null)}>
              Dismiss
            </button>
          </div>
        </Portal>
      ) : null}
      {sessions.length > 0 && cluster ? (
        <Portal>
          <ShellDock
            cluster={cluster}
            sessions={sessions}
            active={active}
            chrome={chrome}
            onChrome={setChrome}
            onActive={setActive}
            onAdd={() => {
              setStartError(null);
              setAsk(true);
            }}
            onClose={closed => {
              const current = sessionsRef.current;
              const closedIndex = current.findIndex(item => item.name === closed.name);
              const next = current.filter(item => item.name !== closed.name);
              sessionsRef.current = next;
              setSessions(next);
              setActive(index => {
                if (closedIndex < index) {
                  return index - 1;
                }
                return Math.max(0, Math.min(index, next.length - 1));
              });
              setChrome('open');
              setStartError(null);
            }}
          />
        </Portal>
      ) : null}
    </>
  );
}
