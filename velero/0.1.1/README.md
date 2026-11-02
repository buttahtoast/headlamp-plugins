# Velero for Headlamp

A first implementation for Headlamp 0.46 and Velero 1.18. It extends the [upstream Velero plugin](https://github.com/headlamp-k8s/plugins/tree/main/velero) workflow with backup operations, artifact access, comparisons and recovery. The upstream cron helpers and tests are retained under Apache 2.0; see [NOTICE](NOTICE).

## Features

- Overview, Backups, Schedules, Restores, Storage and Volume transfers pages.
- Backup scope, complete spec and controller status, progress, errors, warnings, retention, expiration, snapshot counts, item operations and related restores.
- Schedule templates, cron/timezone support, estimated next run, backup history, pause/resume and **Back up now**. Manual runs copy the complete template, including hooks and resource policies, without changing the schedule's paused state.
- Create backups and schedules using forms or advanced JSON specs. Create filtered Velero restores with optional namespace mapping and volume recovery. Kubernetes dry-run validation precedes review and creation.
- Browse manifests from a Velero backup archive, compare individual objects against the live cluster, and compare inventories and fields across two backups. Comparisons ignore controller status, volatile server metadata, kubectl last-applied annotations and Velero tracking labels.
- Download backup/restore logs, results, resource lists, snapshot metadata, volume information and item operations through Velero DownloadRequests.
- Recover one archived object using a Kubernetes create request, with namespace selection, server dry-run and an exact request preview. Existing objects are rejected. Secrets require an explicit reveal action. Server metadata, status, owner references and finalizers are removed; Service addresses and node ports are reallocated.
- Native Headlamp metadata and Events sections on backup, schedule and restore details. Each installation is scoped to its Velero namespace; change it under **Connection**. Settings are per browser and cluster.

## Build

```sh
npm ci
npm run tsc
npm run lint
npm test
npm run build
npm run package
```

Use Node 22. Reader integration tests bind an ephemeral loopback port. The repository's generic Dockerfile and plugin discovery workflow support this directory without additional changes.

## Live development

Headlamp must have a writable plugin directory and the `-watch-plugins-changes` argument. The development script requires an explicit Kubernetes context and updates **every ready replica**, including replacement pods:

```sh
HEADLAMP_CONTEXT=admin@cluster-a npm run dev:cluster

# Build and inject once:
HEADLAMP_CONTEXT=admin@cluster-a npm run dev:cluster -- --once
```

Optional environment variables: `HEADLAMP_KUBECONFIG`, `HEADLAMP_NAMESPACE` (default `capsule-system`), `HEADLAMP_DEPLOYMENT` (`headlamp`), `HEADLAMP_CONTAINER` (`headlamp`), `HEADLAMP_PLUGINS_DIR` (`/build/plugins`). Open **Velero** in Headlamp after injection. Live copies reside in the pods' plugin volume; use the normal plugin image installation for persistence across deployment replacement.

Avoid installing this implementation alongside the upstream Velero plugin because both register Velero routes and sidebar entries.

## Artifact reader

DownloadRequests return short-lived, signed object storage URLs. Direct browser downloads require reachable storage, matching HTTPS policy and storage CORS. The optional reader relays artifacts through Headlamp's authenticated Kubernetes service proxy, supporting internal or HTTP S3 endpoints without exposing storage credentials to the browser.

For the default `velero-system` installation:

```sh
# Set exact storage origins, including scheme and nonstandard port.
kubectl -n velero-system create configmap headlamp-velero-reader \
  --from-file=server.mjs=reader/server.mjs \
  --from-literal=allowed-origins=https://s3.eu-central-1.amazonaws.com \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f reader/deployment.yaml
```

For S3 virtual-host addressing, allow the actual bucket origin present in DownloadRequest URLs, for example `https://my-bucket.s3.eu-central-1.amazonaws.com`. Multiple exact origins can be separated by commas. For another Velero namespace, change all namespaces in the manifests. Restart the reader after changing its code or origins ConfigMap.

Select `headlamp-velero-reader` under **Connection**, or clear the service field to download directly. Local `.tar`/`.tar.gz` import also works without a reader. Imported files are explicitly marked as unverified associations with the selected backup.

The reader's service account can only **get DownloadRequests in its own namespace**. It cannot read storage secrets, create restores or mutate resources. It only follows processed, unexpired requests of known artifact types, restricts downloads to configured origins, rejects redirects, disables caching and caps concurrent requests and artifact sizes. It never accepts client-provided download URLs. The ClusterIP is intended for Kubernetes service proxy access; apply network policies appropriate to your cluster to restrict direct pod access.

## Permissions

[reader/access-role.yaml](reader/access-role.yaml) supplies unbound example roles. Bind the viewer and operator roles to your intended users/groups through existing RBAC. Viewing artifacts includes access to archived Secrets; grant it accordingly. Access through the reader permits reading artifacts in that reader's entire Velero namespace.

- Read the installation's Velero resources with `get/list/watch`.
- Artifact access: `create/get` DownloadRequests and `get` on `services/proxy`, restricted to `headlamp-velero-reader:8080`.
- Operations: `create` Backups/Schedules/Restores and `patch` Schedules. Buttons use SelfSubjectAccessReviews and the API server enforces every operation.
- Individual recovery: API discovery and `create` permission for the **target resource and namespace**. Live comparison additionally needs `get`. Recovery uses the signed-in user's Kubernetes permissions, never the reader's account.

DataUpload and DataDownload records use `velero.io/v2alpha1`; the other supported records use `velero.io/v1`. Missing optional APIs and permission failures appear in their relevant panels.

## Limits of this version

Archive inspection validates tar headers and parses manifests; it does not prove backup authenticity, application consistency or volume recoverability. Archives are held only in browser memory, with limits of 128 MiB compressed, 256 MiB expanded and 50,000 unique objects. Use the Velero CLI for larger archives. Preferred API version copies are deduplicated by group, kind, namespace and name.

Individual recovery creates the captured manifest; it does not execute Velero restore plugins or hooks, recreate owner references, restore PV data or migrate obsolete API versions. Pods, PVCs, PVs and CSI snapshot objects require the native **Restore from backup** flow. Native Velero restores use `existingResourcePolicy: none` by default, with Velero's ServiceAccount merge exception. Advanced JSON can configure other Velero behavior and is reviewed before submission.

The UI does not delete backups or rewrite existing application objects. Backup storage credentials, bucket policy and CORS configuration are administered separately.

## Validation

Validated on the live Headlamp 0.46.0 / Velero 1.18.2 cluster with the real Velero controllers and an isolated, temporary S3 protocol test fixture. Browser checks covered backup creation with dry-run review, archive parsing, unchanged and changed live-object comparisons, two-backup comparisons, rejection of existing objects, single-ConfigMap recovery, a namespace-mapped Velero restore, log downloads and a manual run from a paused schedule. The native restore completed with four objects restored and one warning. No browser page errors were reported. Temporary backup and restore resources, storage and workloads were removed afterward.

Unit and integration tests cover schedule parsing/timezones, request construction, recovery sanitization, object identity/diffs, archive formats/corruption/limits, reader origin restrictions, redirects, error redaction, streaming and Kubernetes ConfigMap symlink startup. Volume-data recovery has not been exercised against a real CSI/FSB backup in this version.
