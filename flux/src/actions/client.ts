import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { ResourceData } from '../common/health';
import {
  ActionOptions,
  buildPatch,
  CAPABILITIES,
  capability,
  isStatic,
  objectPath,
  Operation,
  reconciliationStatus,
  referenceKey,
  ResourceRef,
  resourceRef,
  sourceReference,
  sourceSignature,
  Step,
} from './model';

export type Transport = (
  path: string,
  options: {
    cluster: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    isJSON?: boolean;
    autoLogoutOnAuthError?: boolean;
  }
) => Promise<any>;
export type ProgressState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'submitted'
  | 'failed'
  | 'skipped'
  | 'stopped';
export interface Progress {
  id: string;
  state: ProgressState;
  message: string;
}
let sequence = 0;
export function requestToken() {
  return new Date().toISOString().replace('Z', `${String(++sequence % 1000000).padStart(6, '0')}Z`);
}
export function throwIfStopped(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Stopped. Submitted changes remain in the cluster.');
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Stopped.'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error('Stopped.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createActionClient(transport: Transport = request, pollInterval = 1000) {
  async function send(
    cluster: string,
    path: string,
    options: Partial<Parameters<Transport>[1]> = {},
    signal?: AbortSignal
  ) {
    throwIfStopped(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 20000);
    try {
      return await transport(path, {
        cluster,
        autoLogoutOnAuthError: false,
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function get(ref: ResourceRef, signal?: AbortSignal): Promise<ResourceData> {
    const value = await send(ref.cluster, objectPath(ref), {}, signal);
    if (ref.uid && value.metadata?.uid !== ref.uid)
      throw new Error(
        `${ref.kind} ${ref.namespace}/${ref.name} was replaced. Reload the resource before acting on it.`
      );
    if (
      value.kind !== ref.kind ||
      value.apiVersion !== ref.apiVersion ||
      value.metadata?.name !== ref.name ||
      value.metadata?.namespace !== ref.namespace
    )
      throw new Error('Kubernetes returned an unexpected resource identity.');
    return value;
  }

  async function allowed(ref: ResourceRef, verb: string, signal?: AbortSignal) {
    const cap = capability({ apiVersion: ref.apiVersion, kind: ref.kind });
    try {
      const result = await send(
        ref.cluster,
        '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiVersion: 'authorization.k8s.io/v1',
            kind: 'SelfSubjectAccessReview',
            spec: {
              resourceAttributes: {
                group: cap.group,
                resource: cap.plural,
                name: ref.name,
                namespace: ref.namespace,
                verb,
              },
            },
          }),
        },
        signal
      );
      return result.status?.allowed === true;
    } catch (error) {
      throwIfStopped(signal);
      return false;
    }
  }

  async function sourceRef(
    parent: ResourceRef,
    kind: string,
    namespace: string,
    name: string,
    signal?: AbortSignal
  ): Promise<ResourceRef> {
    const cap = CAPABILITIES[kind];
    if (!cap?.reconcile || cap.group !== 'source.toolkit.fluxcd.io')
      throw new Error(
        `Cannot reconcile a source of kind ${kind}; the Flux CLI does not support that source action.`
      );
    const group = await send(parent.cluster, `/apis/${cap.group}`, {}, signal);
    const versions: string[] = [
      ...new Set(
        [
          group.preferredVersion?.version,
          ...(group.versions || []).map((version: any) => version.version),
        ].filter(Boolean)
      ),
    ] as string[];
    for (const version of versions) {
      const api = await send(parent.cluster, `/apis/${cap.group}/${version}`, {}, signal);
      if (
        api.resources?.some(
          (resource: any) => resource.kind === kind && resource.name === cap.plural
        )
      )
        return {
          cluster: parent.cluster,
          kind,
          namespace,
          name,
          apiVersion: `${cap.group}/${version}`,
        };
    }
    throw new Error(`${kind} is not served by this cluster.`);
  }

  async function patch(ref: ResourceRef, value: unknown, dryRun: boolean, signal?: AbortSignal) {
    return send(
      ref.cluster,
      `${objectPath(ref)}${dryRun ? '?dryRun=All&fieldValidation=Strict' : ''}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify(value),
      },
      signal
    );
  }

  async function prepare(
    refs: ResourceRef[],
    operation: Operation,
    options: ActionOptions,
    signal?: AbortSignal
  ): Promise<Step[]> {
    if (!refs.length) throw new Error('Select at least one resource.');
    if (!['reconcile', 'suspend', 'resume', 'force-apply', 'edit', 'delete'].includes(operation))
      throw new Error('Unknown Flux action.');
    const steps: Step[] = [];
    const byId = new Map<string, Step>();
    async function visit(
      ref: ResourceRef,
      sourceOptions: ActionOptions,
      source = false,
      ancestry = new Set<string>()
    ): Promise<string> {
      throwIfStopped(signal);
      const key = referenceKey(ref);
      if (ancestry.has(key)) throw new Error('A cycle was found in the source references.');
      const id = `${key}/${operation}/${sourceOptions.force ? 'force' : ''}/${
        sourceOptions.reset ? 'reset' : ''
      }`;
      const existing = byId.get(id);
      if (existing) {
        existing.mustWait ||= source;
        return id;
      }
      const snapshot = await get(ref, signal);
      if (snapshot.metadata?.deletionTimestamp) throw new Error(`${ref.name} is being deleted.`);
      const actual = resourceRef(snapshot, ref.cluster);
      const previewToken = requestToken();
      const preview = buildPatch(snapshot, operation, sourceOptions, previewToken);
      if (!(await allowed(actual, operation === 'delete' ? 'delete' : 'patch', signal)))
        throw new Error(
          `Permission denied: ${operation === 'delete' ? 'delete' : 'patch'} ${ref.kind} ${
            ref.namespace
          }/${ref.name} in ${ref.cluster}.`
        );
      const dependencies: string[] = [];
      if (operation === 'reconcile' && sourceOptions.withSource) {
        const source = sourceReference(snapshot);
        if (!source?.name)
          throw new Error(`No reconcilable source is recorded for ${ref.kind} ${ref.name}.`);
        const dependency = await sourceRef(
          actual,
          source.kind,
          source.namespace,
          source.name,
          signal
        );
        dependencies.push(
          await visit(
            dependency,
            { withSource: !!source.withSource, wait: true, timeoutMs: sourceOptions.timeoutMs },
            true,
            new Set([...ancestry, key])
          )
        );
      }
      if (operation === 'delete')
        await send(
          ref.cluster,
          `${objectPath(actual)}?dryRun=All`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deleteOptions(snapshot, true)),
          },
          signal
        );
      else if (preview.some(op => op.op !== 'test')) await patch(actual, preview, true, signal);
      const step: Step = {
        id,
        ref: actual,
        snapshot,
        operation,
        options: sourceOptions,
        sourceSignature: sourceSignature(snapshot),
        token: previewToken,
        dependencies,
        mustWait: source || sourceOptions.wait !== false,
        preview,
      };
      byId.set(id, step);
      steps.push(step);
      return id;
    }
    for (const ref of refs) await visit(ref, options);
    return steps;
  }

  async function wait(step: Step, signal?: AbortSignal) {
    const deadline = Date.now() + (step.options.timeoutMs || 300000);
    while (Date.now() < deadline) {
      throwIfStopped(signal);
      const value = await get(step.ref, signal);
      if (
        step.operation === 'reconcile' &&
        value.metadata?.annotations?.['reconcile.fluxcd.io/requestedAt'] !== step.token &&
        value.status?.lastHandledReconcileAt !== step.token
      )
        throw new Error(
          'Another reconciliation superseded this request. Inspect current status before retrying.'
        );
      const status = reconciliationStatus(value, step.operation, step.token);
      if (status.done) {
        if (status.error) throw new Error(status.error);
        if (
          (!step.options.force || value.status?.lastHandledForceAt === step.token) &&
          (!step.options.reset || value.status?.lastHandledResetAt === step.token)
        )
          return;
      }
      await delay(pollInterval, signal);
    }
    throw new Error(
      `Timed out waiting for ${step.ref.kind} ${step.ref.namespace}/${step.ref.name}. The controller may continue processing the request.`
    );
  }

  async function execute(
    steps: Step[],
    onProgress: (progress: Progress) => void,
    signal?: AbortSignal
  ) {
    const results = new Map<string, ProgressState>();
    for (const step of steps) {
      if (signal?.aborted) {
        onProgress({
          id: step.id,
          state: 'stopped',
          message: 'Not started. Submitted changes remain in the cluster.',
        });
        results.set(step.id, 'stopped');
        continue;
      }
      if (step.dependencies.some(id => !['completed', 'submitted'].includes(results.get(id)))) {
        onProgress({
          id: step.id,
          state: 'skipped',
          message: 'A source action failed; this resource was not changed.',
        });
        results.set(step.id, 'skipped');
        continue;
      }
      try {
        onProgress({ id: step.id, state: 'running', message: 'Checking current resource…' });
        const current = await get(step.ref, signal);
        if (sourceSignature(current) !== step.sourceSignature)
          throw new Error('The source reference changed after review. Review this action again.');
        if (step.operation === 'delete') {
          if (JSON.stringify(current.spec) !== JSON.stringify(step.snapshot.spec))
            throw new Error('Desired configuration changed after review. Review deletion again.');
          await send(
            step.ref.cluster,
            objectPath(step.ref),
            {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(deleteOptions(current)),
            },
            signal
          );
          onProgress({
            id: step.id,
            state: 'submitted',
            message: 'Deletion requested. Flux finalizers may still be processing.',
          });
          results.set(step.id, 'submitted');
          continue;
        }
        const operations = buildPatch(current, step.operation, step.options, step.token);
        if (!operations.some(op => op.op !== 'test')) {
          const message =
            step.operation === 'reconcile' && isStatic(current)
              ? 'Static OCI HelmRepository; no reconciliation is required.'
              : 'Already in the requested state; no change was needed.';
          onProgress({ id: step.id, state: 'completed', message });
          results.set(step.id, 'completed');
          continue;
        }
        await patch(step.ref, operations, false, signal);
        if (
          ['reconcile', 'resume'].includes(step.operation) &&
          step.mustWait &&
          !isStatic(current)
        ) {
          onProgress({
            id: step.id,
            state: 'running',
            message: 'Request submitted. Waiting for the controller…',
          });
          await wait(step, signal);
          onProgress({
            id: step.id,
            state: 'completed',
            message: 'Controller reconciliation completed.',
          });
          results.set(step.id, 'completed');
        } else {
          const state =
            step.operation === 'suspend' || (step.operation === 'resume' && isStatic(current))
              ? 'completed'
              : 'submitted';
          onProgress({
            id: step.id,
            state,
            message:
              step.operation === 'suspend'
                ? 'Suspended.'
                : step.operation === 'resume'
                ? 'Resumed.'
                : step.operation === 'edit'
                ? 'Changes saved.'
                : 'Request submitted.',
          });
          results.set(step.id, state);
        }
      } catch (error) {
        const state = signal?.aborted ? 'stopped' : 'failed';
        onProgress({
          id: step.id,
          state,
          message: signal?.aborted
            ? 'Stopped waiting. Any submitted changes remain in the cluster.'
            : error.message || String(error),
        });
        results.set(step.id, state);
      }
    }
    return results;
  }

  return { get, allowed, prepare, execute, send };
}

function deleteOptions(value: ResourceData, dryRun = false) {
  return {
    apiVersion: 'v1',
    kind: 'DeleteOptions',
    preconditions: { uid: value.metadata?.uid, resourceVersion: value.metadata?.resourceVersion },
    propagationPolicy: 'Background',
    ...(dryRun ? { dryRun: ['All'] } : {}),
  };
}
export const actionClient = createActionClient();
