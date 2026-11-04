/**
 * Exchange an authorization code for an ID token.
 *
 * Dex does not send the CORS headers a browser needs, so a one-shot pod runs
 * curl and prints the ID token on the exec stream. The script does not write
 * the token to disk. The caller deletes the pod. The token is not put in
 * localStorage, a Secret, or the Headlamp server.
 */
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { certificateAuthorityMode, idTokenFromExchangeOutput, pemFromAdminCa } from './kubeconfig';
import {
  decodeExecFrame,
  encodeDelivery,
  encodeExecStdin,
  type ShellLogin,
  shellRequestEnv,
} from './oidc';
import { SHELL_CONTAINER, SHELL_IMAGE, tokenExchangePod, tokenExchangePodName } from './shellPod';

export const TOKEN_EXCHANGE_SCRIPT = `
set -eu
umask 077
IFS= read -r line || exit 1
printf '%s' "$line" | base64 -d > /tmp/request.env
set -a
. /tmp/request.env
set +a
rm -f /tmp/request.env
ca=
if [ -n "\${IDP_CA_PEM:-}" ]; then
  printf '%s\\n' "$IDP_CA_PEM" > /tmp/idp.crt
  ca=/tmp/idp.crt
fi
cleanup() {
  rm -f /tmp/idp.crt /tmp/f-code /tmp/f-verifier /tmp/f-redirect /tmp/f-client /tmp/request.env
}
trap cleanup EXIT
if [ -z "\${CODE:-}" ] || [ -z "\${VERIFIER:-}" ] || [ -z "\${TOKEN_ENDPOINT:-}" ]; then
  printf '%s\\n' 'BUTTAH_TOKEN_FAILED missing sign-in material'
  exit 1
fi
printf '%s' "$CODE" > /tmp/f-code
printf '%s' "$VERIFIER" > /tmp/f-verifier
printf '%s' "$REDIRECT_URI" > /tmp/f-redirect
printf '%s' "$CLIENT_ID" > /tmp/f-client
if [ -n "$ca" ]; then
  resp=$(curl -fsS --cacert "$ca" -X POST "$TOKEN_ENDPOINT" \\
    -H 'Content-Type: application/x-www-form-urlencoded' \\
    --data-urlencode 'grant_type=authorization_code' \\
    --data-urlencode "code@/tmp/f-code" \\
    --data-urlencode "redirect_uri@/tmp/f-redirect" \\
    --data-urlencode "client_id@/tmp/f-client" \\
    --data-urlencode "code_verifier@/tmp/f-verifier") || {
      printf '%s\\n' 'BUTTAH_TOKEN_FAILED the identity provider rejected the authorization code'
      exit 1
    }
else
  resp=$(curl -fsS -X POST "$TOKEN_ENDPOINT" \\
    -H 'Content-Type: application/x-www-form-urlencoded' \\
    --data-urlencode 'grant_type=authorization_code' \\
    --data-urlencode "code@/tmp/f-code" \\
    --data-urlencode "redirect_uri@/tmp/f-redirect" \\
    --data-urlencode "client_id@/tmp/f-client" \\
    --data-urlencode "code_verifier@/tmp/f-verifier") || {
      printf '%s\\n' 'BUTTAH_TOKEN_FAILED the identity provider rejected the authorization code'
      exit 1
    }
fi
id=$(printf '%s' "$resp" | sed -n 's/.*"id_token":"\\([^"]*\\)".*/\\1/p' | head -n 1)
unset resp CODE VERIFIER
if [ -z "$id" ]; then
  printf '%s\\n' 'BUTTAH_TOKEN_FAILED the identity provider returned no ID token'
  exit 1
fi
printf 'BUTTAH_ID_TOKEN %s\\n' "$id"
unset id
`.trim();

type ExecSocket = {
  readyState: number;
  protocol: string;
  send: (data: string | Uint8Array) => void;
  close: () => void;
};

type ExecHandle = {
  cancel: () => void;
  getSocket: () => WebSocket | null;
};

type PodApi = {
  post: (body: object, queryParams: Record<string, string>, cluster: string) => Promise<unknown>;
  delete: (
    namespace: string,
    name: string,
    params: { gracePeriodSeconds: number },
    cluster: string
  ) => Promise<unknown>;
};

function podApi(): PodApi {
  return K8s.ResourceClasses.Pod.apiEndpoint as unknown as PodApi;
}

function incomingText(data: unknown, protocol: string): string {
  if (typeof data === 'string') {
    if (protocol.includes('base64')) {
      try {
        const binary = atob(data);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return decodeExecFrame(bytes)?.text ?? '';
      } catch {
        return '';
      }
    }
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return decodeExecFrame(new Uint8Array(data))?.text ?? '';
  }
  return '';
}

function sendStdin(socket: ExecSocket, line: string) {
  const frame = encodeExecStdin(`${line}\n`);
  if (socket.protocol.includes('base64')) {
    let binary = '';
    for (const byte of frame) {
      binary += String.fromCharCode(byte);
    }
    socket.send(btoa(binary));
    return;
  }
  socket.send(frame);
}

async function waitUntilRunning(cluster: string, namespace: string, name: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const pod = (await ApiProxy.clusterRequest(`/api/v1/namespaces/${namespace}/pods/${name}`, {
      cluster,
    })) as { status?: { phase?: string } };
    if (pod?.status?.phase === 'Running') {
      return;
    }
    if (pod?.status?.phase === 'Failed' || pod?.status?.phase === 'Succeeded') {
      throw new Error('The sign-in pod did not start.');
    }
    await new Promise(resolve => window.setTimeout(resolve, 500));
  }
  throw new Error('The sign-in pod did not start.');
}

function execExchange(
  cluster: string,
  namespace: string,
  name: string,
  login: ShellLogin
): Promise<string> {
  const line = encodeDelivery(shellRequestEnv(login));
  return new Promise((resolve, reject) => {
    let text = '';
    let sent = false;
    let settled = false;
    const finish = (error?: Error, token?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      handle.cancel();
      if (error) {
        reject(error);
      } else {
        resolve(token ?? '');
      }
    };
    const pod = new K8s.ResourceClasses.Pod(
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name, namespace, uid: name, creationTimestamp: '' },
        spec: { containers: [], nodeName: '' },
        status: {
          conditions: [],
          containerStatuses: [],
          phase: 'Running',
          startTime: '',
        },
      },
      cluster
    );
    const handle = pod.exec(
      SHELL_CONTAINER,
      data => {
        const socket = handle.getSocket();
        text += incomingText(data, socket?.protocol ?? '');
        if (text.includes('BUTTAH_ID_TOKEN') || text.includes('BUTTAH_TOKEN_FAILED')) {
          try {
            finish(undefined, idTokenFromExchangeOutput(text));
          } catch (error) {
            finish(
              error instanceof Error ? error : new Error('The sign-in could not be completed.')
            );
          }
        }
      },
      {
        command: ['/bin/sh', '-c', TOKEN_EXCHANGE_SCRIPT],
        tty: false,
        stdin: true,
        stdout: true,
        stderr: true,
        reconnectOnFailure: false,
        failCb: () => undefined,
      }
    ) as ExecHandle;
    const timer = window.setInterval(() => {
      const socket = handle.getSocket();
      if (!sent && socket && socket.readyState === WebSocket.OPEN) {
        sent = true;
        sendStdin(socket, line);
      }
    }, 200);
    const timeout = window.setTimeout(() => {
      finish(new Error('The sign-in timed out.'));
    }, 60_000);
  });
}

export async function exchangeCodeForIdToken(
  cluster: string,
  namespace: string,
  login: ShellLogin,
  image = ''
): Promise<string> {
  const name = tokenExchangePodName();
  await podApi().post(tokenExchangePod(namespace, name, image || SHELL_IMAGE), {}, cluster);
  try {
    await waitUntilRunning(cluster, namespace, name);
    return await execExchange(cluster, namespace, name, login);
  } finally {
    await podApi()
      .delete(namespace, name, { gracePeriodSeconds: 1 }, cluster)
      .catch(() => undefined);
  }
}

export async function loadClusterCa(
  cluster: string,
  adminValue: string | undefined,
  server = ''
): Promise<string> {
  const mode = certificateAuthorityMode(server, adminValue);
  if (mode === 'system') {
    return '';
  }
  if (mode === 'configured') {
    return pemFromAdminCa(adminValue ?? '');
  }
  const response = (await ApiProxy.clusterRequest(
    '/api/v1/namespaces/kube-public/configmaps/kube-root-ca.crt',
    { cluster }
  )) as { data?: Record<string, string> };
  const pem = response?.data?.['ca.crt'];
  if (typeof pem !== 'string' || !pem.includes('BEGIN CERTIFICATE')) {
    throw new Error(
      'The ConfigMap does not set kubeconfig.certificateAuthorityData, and kube-root-ca.crt in kube-public had no certificate.'
    );
  }
  return pem.endsWith('\n') ? pem : `${pem}\n`;
}
