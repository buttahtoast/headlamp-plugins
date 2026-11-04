/**
 * A short-lived shell pod for the dashboard.
 *
 * Matches the Restricted Pod Security Standard and the estate's read-only root:
 * https://kubernetes.io/docs/concepts/security/pod-security-standards/#restricted
 * hostUsers stays unset. The tenant mutate only sets it on pods that ask to
 * run as root, and forcing it can leave the pod unschedulable.
 *
 * Without OIDC, kubectl uses the namespace default ServiceAccount. That grants
 * no extra RBAC. With OIDC, the service-account token is not mounted and
 * kubectl uses the kubeconfig written by the bootstrap script.
 */
import { SHELL_BOOTSTRAP } from './oidc';

export const SHELL_CONTAINER = 'shell';
export const SHELL_USER = 10001;
/** Forgotten shells are stopped by the kubelet. Closing the dock deletes the pod sooner. */
export const SHELL_DEADLINE_SECONDS = 4 * 60 * 60;

const NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export type ShellStatus = {
  phase?: string;
  reason?: string;
  message?: string;
  containerStatuses?: Array<{
    name?: string;
    state?: {
      running?: object;
      waiting?: { reason?: string; message?: string };
      terminated?: { reason?: string; message?: string; exitCode?: number };
    };
  }>;
};

type ShellVolumeMount = { name: string; mountPath: string; readOnly?: boolean };

type ShellVolume =
  | { name: string; emptyDir: { sizeLimit: string } }
  | {
      name: string;
      configMap: { name: string; items: Array<{ key: string; path: string }> };
    };

type ShellPodManifest = {
  apiVersion: 'v1';
  kind: 'Pod';
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
  };
  spec: {
    restartPolicy: 'Never';
    activeDeadlineSeconds: number;
    automountServiceAccountToken: boolean;
    terminationGracePeriodSeconds: number;
    nodeSelector: Record<string, string>;
    securityContext: {
      runAsNonRoot: true;
      runAsUser: number;
      runAsGroup: number;
      fsGroup: number;
      seccompProfile: { type: 'RuntimeDefault' };
    };
    containers: Array<{
      name: string;
      image: string;
      imagePullPolicy: 'IfNotPresent';
      command: string[];
      workingDir: string;
      env: Array<{ name: string; value: string }>;
      securityContext: {
        runAsNonRoot: true;
        runAsUser: number;
        runAsGroup: number;
        allowPrivilegeEscalation: false;
        readOnlyRootFilesystem: true;
        privileged: false;
        capabilities: { drop: ['ALL'] };
        seccompProfile: { type: 'RuntimeDefault' };
      };
      resources: {
        requests: Record<string, string>;
        limits: Record<string, string>;
      };
      volumeMounts: ShellVolumeMount[];
    }>;
    volumes: ShellVolume[];
  };
};

export type ShellPodOptions = {
  identity?: 'service-account' | 'oidc';
  image?: string;
};

export function shellPodName(random: () => number = Math.random): string {
  return namedPod('buttah-shell', random);
}

export function tokenExchangePodName(random: () => number = Math.random): string {
  return namedPod('buttah-kubeconfig', random);
}

function namedPod(prefix: string, random: () => number): string {
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    const pick = Math.min(NAME_ALPHABET.length - 1, Math.floor(random() * NAME_ALPHABET.length));
    suffix += NAME_ALPHABET[pick];
  }
  return `${prefix}-${suffix}`;
}

export function shellPod(
  namespace: string,
  name: string,
  options: ShellPodOptions = {}
): ShellPodManifest {
  const oidc = options.identity === 'oidc';
  const pod: ShellPodManifest = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'buttah-shell',
        'app.kubernetes.io/part-of': 'buttah-kubeconfig',
      },
    },
    spec: {
      restartPolicy: 'Never',
      activeDeadlineSeconds: SHELL_DEADLINE_SECONDS,
      automountServiceAccountToken: !oidc,
      terminationGracePeriodSeconds: 5,
      nodeSelector: { 'kubernetes.io/os': 'linux' },
      securityContext: {
        runAsNonRoot: true,
        runAsUser: SHELL_USER,
        runAsGroup: SHELL_USER,
        fsGroup: SHELL_USER,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: SHELL_CONTAINER,
          image: options.image ?? '',
          imagePullPolicy: 'IfNotPresent',
          command: oidc
            ? ['/bin/sh', '-c', SHELL_BOOTSTRAP]
            : ['/bin/sh', '-c', 'while true; do sleep 3600; done'],
          workingDir: '/work',
          env: [
            { name: 'HOME', value: '/work' },
            { name: 'TMPDIR', value: '/tmp' },
          ],
          securityContext: {
            runAsNonRoot: true,
            runAsUser: SHELL_USER,
            runAsGroup: SHELL_USER,
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            privileged: false,
            capabilities: { drop: ['ALL'] },
            seccompProfile: { type: 'RuntimeDefault' },
          },
          resources: {
            requests: { cpu: '50m', memory: '128Mi', 'ephemeral-storage': '128Mi' },
            limits: { cpu: '500m', memory: '512Mi', 'ephemeral-storage': '256Mi' },
          },
          volumeMounts: [
            { name: 'work', mountPath: '/work' },
            { name: 'tmp', mountPath: '/tmp' },
            ...(oidc ? [{ name: 'kube-ca', mountPath: '/work/ca', readOnly: true }] : []),
          ],
        },
      ],
      volumes: [
        { name: 'work', emptyDir: { sizeLimit: '64Mi' } },
        { name: 'tmp', emptyDir: { sizeLimit: '64Mi' } },
        ...(oidc
          ? [
              {
                name: 'kube-ca',
                configMap: {
                  name: 'kube-root-ca.crt',
                  items: [{ key: 'ca.crt', path: 'ca.crt' }],
                },
              },
            ]
          : []),
      ],
    },
  };
  if (oidc) {
    pod.spec.containers[0].env.push({ name: 'KUBECONFIG', value: '/work/.kube/config' });
  }
  return pod;
}

/** A pod that only exchanges an authorization code. It does not write a kubeconfig. */
export function tokenExchangePod(
  namespace: string,
  name: string,
  image?: string
): ShellPodManifest {
  const pod = shellPod(namespace, name, { identity: 'oidc', image });
  pod.metadata.labels['app.kubernetes.io/name'] = 'buttah-kubeconfig';
  pod.spec.activeDeadlineSeconds = 180;
  pod.spec.containers[0].command = ['/bin/sh', '-c', 'sleep 180'];
  pod.spec.containers[0].env = pod.spec.containers[0].env.filter(
    item => item.name !== 'KUBECONFIG'
  );
  return pod;
}

export function shellRunning(status: ShellStatus | undefined): boolean {
  if (status?.phase !== 'Running') {
    return false;
  }
  return (status.containerStatuses ?? []).some(
    container => container.name === SHELL_CONTAINER && container.state?.running
  );
}

export function shellWait(status: ShellStatus | undefined): string {
  const container = status?.containerStatuses?.find(item => item.name === SHELL_CONTAINER);
  const waiting = container?.state?.waiting;
  if (waiting?.reason) {
    return waiting.message ? `${waiting.reason}. ${waiting.message}` : waiting.reason;
  }
  const terminated = container?.state?.terminated;
  if (terminated?.reason || terminated?.message) {
    return [terminated.reason, terminated.message].filter(Boolean).join('. ');
  }
  if (status?.phase === 'Failed' || status?.phase === 'Succeeded') {
    return [status.phase, status.reason, status.message].filter(Boolean).join('. ');
  }
  if (status?.phase) {
    return status.phase;
  }
  return 'Starting the shell';
}
