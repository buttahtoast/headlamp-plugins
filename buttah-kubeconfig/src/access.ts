/**
 * Cross-plugin registration. Each Headlamp plugin bundles its own copy of this
 * module, so the slot lives on window, not in module state.
 *
 * The shell plugin owns the Cluster access dialog. When the kubeconfig plugin
 * is loaded it registers `start`, and that dialog offers Download kubeconfig.
 * When the shell plugin is absent the kubeconfig plugin shows its own button.
 */

export const ACCESS_EVENT = 'buttah-access';

export type KubeconfigPhase = 'idle' | 'busy' | 'file' | 'error';

export type KubeconfigAccess = {
  start: () => void;
  phase: KubeconfigPhase;
  error: string | null;
};

export type AccessSlot = {
  shell?: { present: true };
  kubeconfig?: KubeconfigAccess;
};

type Host = Window & { __buttahAccess?: AccessSlot };

function host(): Host | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as Host;
}

function slot(): AccessSlot {
  const current = host();
  if (!current) {
    return {};
  }
  if (!current.__buttahAccess) {
    current.__buttahAccess = {};
  }
  return current.__buttahAccess;
}

function publish(): void {
  host()?.dispatchEvent(new CustomEvent(ACCESS_EVENT));
}

export function readAccess(): AccessSlot {
  return host()?.__buttahAccess ?? {};
}

/** Called while the shell plugin module loads, before the first React paint. */
export function registerShellPresence(): () => void {
  slot().shell = { present: true };
  publish();
  return () => {
    const current = slot();
    if (current.shell) {
      delete current.shell;
      publish();
    }
  };
}

export function registerKubeconfigAccess(access: KubeconfigAccess): () => void {
  slot().kubeconfig = access;
  publish();
  return () => {
    const current = slot();
    if (current.kubeconfig === access) {
      delete current.kubeconfig;
      publish();
    }
  };
}

export function updateKubeconfigAccess(patch: Partial<KubeconfigAccess>): void {
  const current = slot().kubeconfig;
  if (!current) {
    return;
  }
  slot().kubeconfig = { ...current, ...patch };
  publish();
}
