import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  decodeExecFrame,
  deliveryFailure,
  deliveryOutcome,
  encodeDelivery,
  encodeExecStdin,
  SHELL_CONTAINER,
  SHELL_DELIVER,
  type ShellLogin,
  shellRequestEnv,
} from './local';

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

function podExec(
  cluster: string,
  namespace: string,
  name: string,
  onData: (data: unknown) => void
) {
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
  return pod.exec(SHELL_CONTAINER, onData, {
    command: ['/bin/sh', '-c', SHELL_DELIVER],
    tty: false,
    stdin: true,
    stdout: true,
    stderr: true,
    reconnectOnFailure: false,
    failCb: () => undefined,
  }) as ExecHandle;
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

/** Write the sign-in material over exec stdin and wait until kubeconfig is ready. */
export function deliverShellLogin(
  cluster: string,
  namespace: string,
  name: string,
  login: ShellLogin
): Promise<void> {
  const line = encodeDelivery(shellRequestEnv(login));
  return new Promise((resolve, reject) => {
    let text = '';
    let sent = false;
    let settled = false;
    const finish = (error?: Error) => {
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
        resolve();
      }
    };
    const handle = podExec(cluster, namespace, name, data => {
      const socket = handle.getSocket();
      text += incomingText(data, socket?.protocol ?? '');
      const outcome = deliveryOutcome(text);
      if (outcome === 'ready') {
        finish();
      } else if (outcome === 'failed') {
        finish(new Error(deliveryFailure(text)));
      }
    });
    const timeout = window.setTimeout(() => {
      finish(new Error(deliveryFailure(text) || 'The shell did not finish signing in.'));
    }, 45_000);
    const timer = window.setInterval(() => {
      const socket = handle.getSocket();
      if (!socket || socket.readyState !== WebSocket.OPEN || sent) {
        return;
      }
      sent = true;
      sendStdin(socket, line);
    }, 50);
  });
}
