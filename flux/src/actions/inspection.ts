import { ResourceData } from '../common/health';
import { actionClient } from './client';
import { actionDefinitions, capability, cliCommand, ResourceRef } from './model';

export function matchesLog(line: string, ref: ResourceRef) {
  try {
    const item = JSON.parse(line);
    const nested = item[ref.kind[0].toLowerCase() + ref.kind.slice(1)] || item[ref.kind];
    const kind = item.controllerKind || item.kind;
    return (
      (kind === ref.kind || !!nested) &&
      (nested?.name || item.name) === ref.name &&
      (nested?.namespace || item.namespace) === ref.namespace
    );
  } catch {
    return false;
  }
}

export async function inspectResource(
  ref: ResourceRef,
  view: string,
  controllerNamespace: string,
  signal: AbortSignal
): Promise<ResourceData | string> {
  const object = await actionClient.get(ref, signal);
  if (view === 'events') {
    const events = await actionClient.send(
      ref.cluster,
      `/api/v1/namespaces/${encodeURIComponent(
        ref.namespace
      )}/events?fieldSelector=${encodeURIComponent(`involvedObject.uid=${object.metadata.uid}`)}`,
      {},
      signal
    );
    return (events.items || []).sort((a: any, b: any) =>
      (a.lastTimestamp || a.eventTime || a.metadata.creationTimestamp).localeCompare(
        b.lastTimestamp || b.eventTime || b.metadata.creationTimestamp
      )
    );
  }
  if (view === 'logs') {
    const controller = capability(object).controller;
    const base = `/api/v1/namespaces/${encodeURIComponent(controllerNamespace)}/pods`;
    let pods = await actionClient.send(
      ref.cluster,
      `${base}?labelSelector=${encodeURIComponent(`app.kubernetes.io/component=${controller}`)}`,
      {},
      signal
    );
    if (!pods.items?.length)
      pods = await actionClient.send(
        ref.cluster,
        `${base}?labelSelector=${encodeURIComponent(`app=${controller}`)}`,
        {},
        signal
      );
    if (!pods.items?.length)
      throw new Error(
        `No ${controller} pods found in ${controllerNamespace}. Set the namespace where Flux controllers run.`
      );
    const results = await Promise.all(
      pods.items.slice(0, 10).map(async (pod: any) => {
        const container =
          pod.spec?.containers?.find((item: any) => item.name === 'manager')?.name ||
          pod.spec?.containers?.[0]?.name;
        const response = await actionClient.send(
          ref.cluster,
          `${base}/${encodeURIComponent(
            pod.metadata.name
          )}/log?tailLines=1000&limitBytes=1048576&container=${encodeURIComponent(container)}`,
          { isJSON: false },
          signal
        );
        const content = typeof response === 'string' ? response : await response.text();
        const lines = content.split('\n').filter((line: string) => matchesLog(line, ref));
        return `# ${pod.metadata.name}\n${
          lines.join('\n') || 'No matching resource log entries in the last 1,000 lines.'
        }`;
      })
    );
    return results.join('\n\n');
  }
  return object;
}

export function commandsFor(object: ResourceData) {
  const cap = capability(object);
  const target = `'${object.metadata.name}' --namespace '${object.metadata.namespace}' --context '<kubeconfig-context>'`;
  const commands = actionDefinitions(object)
    .filter(action => action.operation && action.id !== 'edit')
    .map(
      action => `${'# ' + action.label}\n${cliCommand(object, action.operation, action.options)}`
    );
  commands.push(
    `# Export\n${cliCommand(object, 'export')}`,
    '# Set --context to the context name from your own kubeconfig.'
  );
  if (!cap.extension)
    commands.push(
      `# Events\nflux events --for '${object.kind}/${object.metadata.name}' --namespace '${object.metadata.namespace}' --context '<kubeconfig-context>'`,
      `# Follow resource logs\nflux logs --kind '${object.kind}' --name ${target} --follow --flux-namespace flux-system`,
      `# Trace GitOps ownership\nflux trace ${target} --kind '${object.kind}' --api-version '${object.apiVersion}'`
    );
  if (['Kustomization', 'HelmRelease'].includes(object.kind)) {
    commands.push(
      `# Debug status / history\nflux debug ${cap.cli} ${target} --show-status\nflux debug ${cap.cli} ${target} --show-history`
    );
    commands.push(
      object.kind === 'HelmRelease'
        ? `# Resolved Helm values (can include referenced Secret values)\nflux debug helmrelease ${target} --show-values`
        : `# Resolved substitution variables (can include referenced Secret values)\nflux debug kustomization ${target} --show-vars\n\n# Inventory tree\nflux tree kustomization ${target}`
    );
  }
  if (
    object.kind === 'Receiver' &&
    ['generic', 'generic-hmac', 'generic-oidc'].includes(object.spec?.type)
  ) {
    commands.push(
      `# Trigger incoming webhook from your terminal; configure the URL and token environment variable\nflux trigger receiver '${
        object.metadata.name
      }' --namespace '${object.metadata.namespace}' --type '${
        object.spec.type
      }' --url 'https://<webhook-host>' ${
        object.spec.type === 'generic-oidc'
          ? '--oidc-token "$FLUX_TRIGGER_RECEIVER_OIDC_TOKEN"'
          : '--token "$FLUX_RECEIVER_TOKEN"'
      } --payload '{}'`
    );
  }
  if (object.kind === 'Kustomization')
    commands.push(
      `# Local checkout required: build / diff\nflux build kustomization ${target} --path './path/to/checkout'\nflux diff kustomization ${target} --path './path/to/checkout'`
    );
  return commands.join('\n\n');
}
