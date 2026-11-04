/**
 * OIDC for the shell pod.
 *
 * Headlamp keeps the logged-in user's token in an HttpOnly cookie, so this
 * plugin cannot read it. A public authorization-code + PKCE flow mints a
 * separate ID token for the same issuer. The API server has to trust that
 * issuer and this client id as an audience.
 *
 * The code is delivered to the pod over a one-shot exec, not a Secret, so it
 * is not stored in etcd. The pod exchanges it when the identity provider does
 * not allow the browser to call the token endpoint (Dex does not).
 */
import bootstrapSource from './shellBootstrap.sh?raw';
import type { ShellPrefs } from './types';

export const SHELL_BOOTSTRAP = bootstrapSource;

export const DEFAULT_SHELL_SCOPES = 'openid email profile groups offline_access';

export const OIDC_PENDING_KEY = 'buttah-shell.oidc-pending';
export const OIDC_RESULT_KEY = 'buttah-shell.oidc-result';
export const OIDC_MESSAGE_SOURCE = 'buttah-shell-oidc';

const PKCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export const defaultShellPrefs: ShellPrefs = {
  issuerUrl: '',
  clientId: '',
  scopes: DEFAULT_SHELL_SCOPES,
  authorizationEndpoint: '',
  tokenEndpoint: '',
  image: '',
  namespace: '',
  idpCaPem: '',
};

export type OidcEndpoints = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** True when the browser successfully read the discovery document. */
  browserDiscovery: boolean;
};

export type OidcAttempt = {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
  url: string;
};

export type OidcPending = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  namespace: string;
  cluster: string;
  returnUrl: string;
  issuerUrl: string;
  clientId: string;
  scopes: string;
  tokenEndpoint: string;
  authorizationEndpoint: string;
  idpCaPem: string;
  image: string;
  browserExchange: boolean;
  createdAt: number;
};

export type OidcResult = {
  source?: string;
  state?: string;
  code?: string;
  error?: string;
  description?: string;
  createdAt?: number;
};

export type ShellLogin = {
  issuerUrl: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  tokenEndpoint: string;
  code: string;
  verifier: string;
  nonce: string;
  idToken: string;
  refreshToken: string;
  idpCaPem: string;
  namespace: string;
};

const REQUEST_KEYS = [
  'ISSUER',
  'CLIENT_ID',
  'SCOPES',
  'REDIRECT_URI',
  'TOKEN_ENDPOINT',
  'CODE',
  'VERIFIER',
  'NONCE',
  'ID_TOKEN',
  'REFRESH_TOKEN',
  'IDP_CA_PEM',
  'KUBE_NAMESPACE',
] as const;

export function shellIdentityAvailable(shell: ShellPrefs | undefined): boolean {
  return Boolean(shell?.issuerUrl.trim() && shell?.clientId.trim());
}

export function normalizeShellPrefs(value: unknown): ShellPrefs {
  const raw = value && typeof value === 'object' ? (value as Partial<ShellPrefs>) : {};
  const text = (field: unknown) => (typeof field === 'string' ? field : '');
  return {
    issuerUrl: text(raw.issuerUrl),
    clientId: text(raw.clientId),
    scopes: typeof raw.scopes === 'string' ? raw.scopes : DEFAULT_SHELL_SCOPES,
    authorizationEndpoint: text(raw.authorizationEndpoint),
    tokenEndpoint: text(raw.tokenEndpoint),
    image: text(raw.image),
    namespace: text(raw.namespace),
    idpCaPem: text(raw.idpCaPem),
  };
}

export function shellRedirectUri(origin: string, baseUrl = ''): string {
  let base = baseUrl.trim();
  if (base === '/' || base === '.' || base === './') {
    base = '';
  }
  base = base.replace(/\/$/, '');
  const root = origin.replace(/\/$/, '');
  return `${root}${base}/buttah/shell-oidc`;
}

export function currentRedirectUri(): string {
  if (typeof window === 'undefined') {
    return shellRedirectUri('http://127.0.0.1');
  }
  const configured = (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl;
  return shellRedirectUri(window.location.origin, typeof configured === 'string' ? configured : '');
}

export function assertHttpUrl(value: string, label: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} is not a URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include a username or password.`);
  }
  if (url.protocol === 'https:') {
    return url.toString();
  }
  const host = url.hostname;
  const local =
    url.protocol === 'http:' &&
    (host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.cluster.local'));
  if (local) {
    return url.toString();
  }
  throw new Error(`${label} must use https.`);
}

export function assertClientId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(id)) {
    throw new Error('Client ID must use letters, numbers, and . _ : -.');
  }
  return id;
}

export function normalizeScopes(value: string): string {
  const parts = (value.trim() || DEFAULT_SHELL_SCOPES).split(/\s+/).filter(Boolean);
  if (parts.some(part => !/^[A-Za-z0-9_.:/-]+$/.test(part))) {
    throw new Error('Scopes must be a space-separated list of OIDC scope names.');
  }
  if (!parts.includes('openid')) {
    throw new Error('Scopes must include openid.');
  }
  return parts.join(' ');
}

export function assertNamespace(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error('Choose a namespace for the shell pod.');
  }
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) || name.length > 63) {
    throw new Error('Namespace must be a DNS label.');
  }
  return name;
}

export function assertImage(value: string, fallback: string): string {
  const image = value.trim() || fallback;
  if (!image || /\s/.test(image)) {
    throw new Error('The shell image cannot contain whitespace.');
  }
  return image;
}

export function idpCaOrEmpty(value: string): string {
  const pem = value.replace(/\r\n/g, '\n').trim();
  if (!pem) {
    return '';
  }
  if (
    pem.length > 20000 ||
    !pem.includes('BEGIN CERTIFICATE') ||
    !pem.includes('END CERTIFICATE')
  ) {
    throw new Error('The identity provider CA must be a PEM certificate.');
  }
  return `${pem}\n`;
}

function randomUnit(): number {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 256;
}

export function randomToken(size = 32, random: () => number = randomUnit): string {
  let value = '';
  for (let index = 0; index < size; index += 1) {
    value += PKCE_ALPHABET[Math.floor(random() * PKCE_ALPHABET.length)];
  }
  return value;
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** S256 challenge from RFC 7636. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function createOidcAttempt(
  input: {
    authorizationEndpoint: string;
    clientId: string;
    redirectUri: string;
    scopes: string;
  },
  random: () => number = randomUnit
): Promise<OidcAttempt> {
  const verifier = randomToken(64, random);
  const state = randomToken(32, random);
  const nonce = randomToken(32, random);
  const challenge = await pkceChallenge(verifier);
  const endpoint = assertHttpUrl(input.authorizationEndpoint, 'Authorization endpoint');
  const url = new URL(endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'login');
  return { state, nonce, verifier, challenge, url: url.toString() };
}

export function discoveryUrl(issuer: string): string {
  return `${assertHttpUrl(issuer, 'Issuer URL').replace(
    /\/$/,
    ''
  )}/.well-known/openid-configuration`;
}

export async function resolveOidcEndpoints(
  shell: ShellPrefs,
  fetchImpl: typeof fetch = fetch
): Promise<OidcEndpoints> {
  const issuer = assertHttpUrl(shell.issuerUrl, 'Issuer URL');
  let authorizationEndpoint = shell.authorizationEndpoint.trim();
  let tokenEndpoint = shell.tokenEndpoint.trim();
  let browserDiscovery = false;
  if (!authorizationEndpoint || !tokenEndpoint) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetchImpl(discoveryUrl(issuer), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`Discovery returned ${response.status}.`);
        }
        const body = (await response.json()) as {
          authorization_endpoint?: unknown;
          token_endpoint?: unknown;
        };
        if (!authorizationEndpoint && typeof body.authorization_endpoint === 'string') {
          authorizationEndpoint = body.authorization_endpoint;
        }
        if (!tokenEndpoint && typeof body.token_endpoint === 'string') {
          tokenEndpoint = body.token_endpoint;
        }
        browserDiscovery = true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      browserDiscovery = false;
    }
  }
  if (!authorizationEndpoint) {
    throw new Error(
      'The browser could not read the issuer discovery document. Set the authorization endpoint in plugin settings. Register the shell redirect URI on a public client.'
    );
  }
  return {
    authorizationEndpoint: assertHttpUrl(authorizationEndpoint, 'Authorization endpoint'),
    tokenEndpoint: tokenEndpoint ? assertHttpUrl(tokenEndpoint, 'Token endpoint') : '',
    browserDiscovery,
  };
}

export function sameString(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function safeOauthError(error: string, description?: string): string {
  const code = /^[a-z0-9_ ]{1,80}$/i.test(error) ? error : 'sign-in failed';
  const detail =
    description && /^[\w .,:'()/+-]{1,180}$/.test(description) ? ` ${description}` : '';
  return `The identity provider rejected the sign-in (${code}).${detail}`;
}

export function takeOidcCode(pending: OidcPending, result: OidcResult, now = Date.now()): string {
  if (!result.state || !sameString(pending.state, result.state)) {
    throw new Error('The sign-in response did not match this attempt.');
  }
  if (!result.createdAt || now - result.createdAt > 2 * 60 * 1000) {
    throw new Error('The sign-in response expired. Start the shell again.');
  }
  if (now - pending.createdAt > 10 * 60 * 1000) {
    throw new Error('The sign-in attempt expired. Start the shell again.');
  }
  if (result.error) {
    throw new Error(safeOauthError(result.error, result.description));
  }
  if (!result.code || !/^[A-Za-z0-9._~-]{1,512}$/.test(result.code)) {
    throw new Error('The identity provider did not return an authorization code.');
  }
  return result.code;
}

export function redactOidcBody(body: string): string {
  if (/id_token|access_token|refresh_token|code_verifier/.test(body)) {
    return 'The identity provider response was withheld because it looked like a token.';
  }
  const trimmed = body.replace(/\s+/g, ' ').trim();
  return trimmed.slice(0, 280) || 'The identity provider rejected the request.';
}

export async function exchangeAuthorizationCode(
  input: {
    tokenEndpoint: string;
    clientId: string;
    redirectUri: string;
    code: string;
    verifier: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ idToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
  });
  let response: Response;
  try {
    response = await fetchImpl(input.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
  } catch {
    throw new Error(
      'The browser could not read the token endpoint. Set the authorization endpoint in plugin settings so discovery stays in the pod, then start the shell again.'
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(redactOidcBody(text));
  }
  let parsed: { id_token?: unknown; refresh_token?: unknown };
  try {
    parsed = JSON.parse(text) as { id_token?: unknown; refresh_token?: unknown };
  } catch {
    throw new Error('The token endpoint did not return JSON.');
  }
  if (typeof parsed.id_token !== 'string' || !parsed.id_token) {
    throw new Error('The token endpoint did not return an ID token.');
  }
  return {
    idToken: parsed.id_token,
    refreshToken: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : '',
  };
}

export function jwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    throw new Error('The ID token was not a JWT.');
  }
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  let json: string;
  try {
    json = atob(padded + pad);
  } catch {
    throw new Error('The ID token was not a JWT.');
  }
  try {
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== 'object') {
      throw new Error('The ID token was not a JWT.');
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'The ID token was not a JWT.') {
      throw error;
    }
    throw new Error('The ID token was not a JWT.');
  }
}

export function assertIdTokenClaims(
  token: string,
  expected: { issuer: string; audience: string; nonce: string }
): void {
  const payload = jwtPayload(token);
  const issuer = typeof payload.iss === 'string' ? payload.iss.replace(/\/$/, '') : '';
  if (issuer !== expected.issuer.replace(/\/$/, '')) {
    throw new Error('The ID token issuer did not match the plugin setting.');
  }
  const audience = payload.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (!audiences.includes(expected.audience)) {
    throw new Error(
      'The ID token audience did not match the client ID. The API server will reject it unless that client id is a trusted audience.'
    );
  }
  if (payload.nonce !== expected.nonce) {
    throw new Error('The ID token nonce did not match this sign-in.');
  }
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellRequestEnv(login: ShellLogin): string {
  const fields: Record<(typeof REQUEST_KEYS)[number], string> = {
    ISSUER: login.issuerUrl,
    CLIENT_ID: login.clientId,
    SCOPES: login.scopes,
    REDIRECT_URI: login.redirectUri,
    TOKEN_ENDPOINT: login.tokenEndpoint,
    CODE: login.code,
    VERIFIER: login.verifier,
    NONCE: login.nonce,
    ID_TOKEN: login.idToken,
    REFRESH_TOKEN: login.refreshToken,
    IDP_CA_PEM: login.idpCaPem,
    KUBE_NAMESPACE: login.namespace,
  };
  return `${REQUEST_KEYS.map(key => `${key}=${shellSingleQuote(fields[key])}`).join('\n')}\n`;
}

export function encodeDelivery(envFile: string): string {
  const bytes = new TextEncoder().encode(envFile);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export const SHELL_DELIVER =
  'umask 077; mkdir -p /work/.kube; IFS= read -r line; printf %s "$line" | base64 -d > /work/.kube/request.env.tmp && mv /work/.kube/request.env.tmp /work/.kube/request.env; i=0; while [ ! -s /work/.kube/ready ]; do i=$((i+1)); if [ "$i" -gt 160 ]; then echo BUTTAH_SHELL_FAILED; if [ -s /dev/termination-log ]; then cat /dev/termination-log; fi; exit 1; fi; sleep 0.25; done; echo BUTTAH_SHELL_READY';

export function deliveryOutcome(text: string): 'ready' | 'failed' | 'pending' {
  if (text.includes('BUTTAH_SHELL_READY')) {
    return 'ready';
  }
  if (text.includes('BUTTAH_SHELL_FAILED')) {
    return 'failed';
  }
  return 'pending';
}

export function deliveryFailure(text: string): string {
  const marker = 'BUTTAH_SHELL_FAILED';
  const index = text.indexOf(marker);
  const rest = (index >= 0 ? text.slice(index + marker.length) : text).trim();
  if (!rest || /id_token|refresh_token|code_verifier|eyJ/.test(rest)) {
    return 'The shell could not finish signing in.';
  }
  return rest.slice(0, 300);
}

export function decodeExecFrame(bytes: Uint8Array): { channel: number; text: string } | null {
  if (bytes.length === 0) {
    return null;
  }
  return { channel: bytes[0], text: new TextDecoder().decode(bytes.subarray(1)) };
}

export function encodeExecStdin(payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = 0;
  frame.set(body, 1);
  return frame;
}

export function prepareShellLogin(input: {
  shell: ShellPrefs;
  namespace: string;
  redirectUri: string;
  endpoints: OidcEndpoints;
  fallbackImage: string;
}): { image: string; clientId: string; issuerUrl: string; scopes: string; idpCaPem: string } {
  return {
    image: assertImage(input.shell.image, input.fallbackImage),
    clientId: assertClientId(input.shell.clientId),
    issuerUrl: assertHttpUrl(input.shell.issuerUrl, 'Issuer URL').replace(/\/$/, ''),
    scopes: normalizeScopes(input.shell.scopes),
    idpCaPem: idpCaOrEmpty(input.shell.idpCaPem),
  };
}

export function readStoredResult(): OidcResult | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const raw = localStorage.getItem(OIDC_RESULT_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as OidcResult;
    if (!parsed || parsed.source !== OIDC_MESSAGE_SOURCE) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredResult(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(OIDC_RESULT_KEY);
  }
}

export function readStoredPending(): OidcPending | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  const raw = sessionStorage.getItem(OIDC_PENDING_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as OidcPending;
    if (!parsed?.state || !parsed.verifier) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function storePending(pending: OidcPending): void {
  sessionStorage.setItem(OIDC_PENDING_KEY, JSON.stringify(pending));
}

export function clearPending(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(OIDC_PENDING_KEY);
  }
}

export const OIDC_UNCONFIGURED = 'Set the issuer and client in the config file.';

export const OIDC_HEADLAMP_SEPARATE = 'Set the issuer and client in the config file.';

export const OIDC_CONFIGURED = '';

/** auth_type from Headlamp GET /config. v0.46 sends "oidc" or "". */
export function headlampAuthType(cluster: { auth_type?: unknown } | null | undefined): string {
  return typeof cluster?.auth_type === 'string' ? cluster.auth_type : '';
}

/** Cluster names whose /config entry says auth_type is oidc. Settings are not on a cluster URL. */
export function headlampOidcClusterNames(
  clusters: Record<string, { auth_type?: unknown } | null | undefined> | null | undefined
): string[] {
  if (!clusters) {
    return [];
  }
  return Object.entries(clusters)
    .filter(([, cluster]) => headlampAuthType(cluster) === 'oidc')
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

export function shellIdentityNote(configured: boolean, authType: string): string {
  if (configured) {
    return OIDC_CONFIGURED;
  }
  if (authType === 'oidc') {
    return OIDC_HEADLAMP_SEPARATE;
  }
  return OIDC_UNCONFIGURED;
}
