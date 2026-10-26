# Flux operations draft

This directory starts from the upstream Headlamp Flux plugin v0.7.0 and retains its routes, reconciliation/suspend/resume actions, source views, notifications, image automation, Flagger and map source. Runtime and Terraform pages/integrations are removed from this draft.

The draft follows the installed plugins listed in Headlamp's plugin manager:

- [Cilium 0.1.0](https://github.com/batuhancikrikci/headlamp-plugins/tree/main/cilium): dashboard header, controller cards, issue panels, namespace readiness, installation context and grouped resource shortcuts.
- [Capsule 0.3.1](https://github.com/projectcapsule/headlamp-plugin/tree/v0.3.1): shared statistics cards with readiness donuts and chips, and interactive source/dependency/namespace/object relationship diagrams. The Capsule statistics card and visibility helpers are adapted directly; the SSA ownership view also follows the current Capsule GlobalTenantResource implementation. See NOTICE.

## Changes

- Overview navigation uses the globally unique `flux-overview` route and sidebar ID, so the Capsule plugin and other overview pages can coexist without overwriting its menu entry. The URL remains `/flux/overview`.

- A shared **Actions** menu on every Flux resource list row and detail view, plus bulk actions for selected rows. Menus are specific to the API group and kind; unsupported commands are omitted. Existing Headlamp header actions remain available, including Edit, Delete, Scale and Rollback. Flux ownership adds only a small icon in the header; it does not restrict changes or add labels to objects.
- Reconcile, reconcile with source, suspend/resume, HelmRelease one-off force and failure-counter reset, and Kustomization persistent force apply. Reconciliation follows repository → HelmChart → HelmRelease dependencies, deduplicates shared sources and waits for source completion before continuing.
- Inspect status, events and resource-filtered controller logs; view/export portable YAML, review YAML edits, delete with typed confirmation, and copy CLI commands. Source-watcher ArtifactGenerators are included when that optional API exists.
- Mutations through the Flux Actions menu check the signed-in user's Kubernetes permissions and perform server dry-runs. Review shows exact targets, cluster, patch and CLI equivalent. Requests test UID/resourceVersion; YAML edits also detect changes to edited fields while preserving unrelated concurrent changes. Deletion uses UID/version preconditions and checks for changed desired configuration.
- Reconciliations distinguish submitted requests from controller completion, check request acknowledgments and current generation, support timeouts, partial bulk results, failed-target retries and stopping pending work. Runs remain accessible from the app bar while navigating within Headlamp. A page reload ends monitoring, and accepted changes continue in the cluster.
- Statistics above Kustomization, HelmRelease, Sources, Notifications, Image Automation and Canary lists. Statistics use the same namespace/tenant and search filters as their lists.
- The overview counts Flux resources across selected clusters and visible namespaces, or the active namespace filter. It uses independent GET snapshots with pagination and API-version fallback, up to six concurrent requests, a 15-second collection deadline and a 20-second refresh deadline. Completed lists appear immediately; missing optional APIs settle as absent, and permission failures/timeouts show explicit partial-visibility errors. Refresh manually or automatically 30 seconds after the previous attempt finishes; previous data remains visible during refresh. Scope changes cancel stale requests. Controller discovery uses Flux deployment labels outside the application namespace filter while honoring allowed namespaces, and separates scaled-to-zero controllers from unhealthy replicas.
- Shared condition classification distinguishes Ready, Failed, Reconciling, Suspended, Configured and Unknown. A condition from an older generation does not count as current readiness.
- Kustomization and HelmRelease inventories have a diagram and table, filters by namespace/kind/name, live object inspection, navigation links, zoom, pan and a minimap.
- Inventory diagrams group resource cards into aligned namespace containers on a shared grid, with a separate cluster-scoped group. The redundant card for the open Kustomization/HelmRelease is omitted. Source and dependency context remains visible.
- The standalone [SSA Inspector](../ssa/README.md) adds an SSA action to standard Kubernetes resource headers. Flux and that plugin now bundle the same shared viewer; Flux keeps its inventory shortcut and preferred-manager selection.
- **Inspect → SSA apply diff** follows Capsule’s GlobalTenantResource view: it refreshes the live object and highlights fields owned by Flux Apply managers within live-object context. Manager selection exposes other Apply records and labels Helm Update ownership explicitly, selecting the Flux Update manager when no Flux Apply record exists. Status-subresource ownership is excluded. Secret values stay hidden in both diff and YAML until revealed. This is an ownership view from `metadata.managedFields`; it does not reconstruct historical applied values or compare a Git checkout with the cluster.
- Large inventories start grouped by namespace and kind. Click a kind to inspect individual objects; the expanded graph caps at 160 matching objects while the table retains every object.
- Missing objects and permission failures remain visible. Discovery determines actual resource plurals and scope. Requests run with bounded concurrency and are cancelled when the inventory changes.
- Cluster-scoped inventory IDs and names containing underscores are parsed correctly.
- Helm inventories use the rendered release manifest from the release storage Secret, with the recorded Helm release identity and storage namespace. This includes generated names and cross-namespace resources. It uses the user's existing Secret permissions; inaccessible release records produce an explicit message. Secret contents in the inspector are hidden until revealed.

## Build and live development

Use Node 22 LTS and npm 10 or newer. Keep the sibling `../ssa` package in the checkout: Flux imports its shared viewer as a local file dependency. After editing the shared viewer, rerun `npm ci` here before rebuilding Flux.

```sh
npm ci
npm run format -- --check
npm run lint
npm run tsc
CI=1 npm test
npm run build
npm run package

# Build and inject into every ready Headlamp replica:
HEADLAMP_CONTEXT=admin@cluster-a npm run dev:cluster -- --once

# Watch and resync changes/replacement pods:
HEADLAMP_CONTEXT=admin@cluster-a npm run dev:cluster
```

The context must be explicit. Optional settings: `HEADLAMP_KUBECONFIG`, `HEADLAMP_NAMESPACE` (default `capsule-system`), `HEADLAMP_DEPLOYMENT` (`headlamp`), `HEADLAMP_CONTAINER` (`headlamp`), `HEADLAMP_PLUGINS_DIR` (`/build/plugins`). The target directory is `headlamp_flux`, matching the upstream plugin installation name. Headlamp must enable `-watch-plugins-changes` and have a writable plugin volume. Live injection is ephemeral: pod replacement or the plugin manager reinstalling plugins can remove it; use the watch script during development or a persistent plugin image for deployment.

Refresh Headlamp and open **Flux → Overview**. Open a Kustomization or HelmRelease and scroll to **Inventory** for the relationship view. The Runtime and Terraform routes are removed; other URLs are retained.

## Resource operations

| Resources | Reconcile | With source | Suspend / resume | Additional operations |
| --- | --- | --- | --- | --- |
| Kustomization | Yes | Yes | Yes | Persistent force apply |
| HelmRelease | Yes | Yes | Yes | One-off force install/upgrade; reset failures |
| GitRepository, OCIRepository, Bucket, HelmRepository | Yes | — | Yes | OCI-type HelmRepository is static; reconcile is a no-op |
| HelmChart | Yes | Yes | Yes | Reconciles its repository first |
| ImageRepository, ImagePolicy, ImageUpdateAutomation, Receiver | Yes | — | Yes | — |
| Alert, Provider | — | — | Yes | Configuration resources have no Ready wait |
| ExternalArtifact, ArtifactGenerator | — | — | — | Status, events, logs, YAML, export, edit, delete |
| Flagger Canary extension | — | — | Yes | Suspend pauses the canary run; resume updates its setting |

All rows also offer status, events, controller logs, YAML view/export/edit and deletion. Mutations require the matching Kubernetes RBAC permissions. Bulk menus contain the actions shared by the selected kinds. Sources must be resumed before a dependent reconciliation can run. Force and reset apply only to HelmRelease; they do not change `spec.force`.

Behavior follows the [Flux CLI resource commands](https://fluxcd.io/flux/cmd/) and [HelmRelease reconcile annotations](https://fluxcd.io/flux/components/helm/helmreleases/#triggering-a-reconcile), checked against Flux CLI v2.9.4 source. The CLI commands view also includes trace, tree, debug status/history, resolved Helm values/substitution variables, and supported generic Receiver webhook triggers. Operations needing a local checkout (`flux build` / `flux diff`), resolved credential values, or external webhook authentication run as terminal commands; templates do not fetch credentials automatically. Bootstrap/install, credential generation, artifact upload and arbitrary shell execution are outside resource actions. Controller logs show matching structured resource entries from the latest 1,000 lines per pod and use an editable controller namespace.

## Validation and draft limits

Unit/integration tests mount the overview with its real loader and cover successful data rendering, absent/stalled optional APIs, loading completion, manual refresh, stable rerenders, namespace/cluster scope changes, pagination and cancellation. Captured live API responses verified 11 Kustomizations, 68 HelmReleases and six controller cards in the mounted view. Other checks cover condition classification, scoped dashboard rendering, permission failures, inventory IDs, graph grouping/layout/edges, rendered Helm manifests, discovery, cluster scope and cancellation, together with the retained upstream tests. Inventory checks cover namespace parent bounds, shared grid alignment, deterministic layout, Flux manager selection, keyed/set/indexed SSA lists, partial map ownership, unowned context, Helm Update labeling and Secret reveal controls. Action tests cover per-kind menus, annotations, dependency ordering/deduplication, dry-runs, permission failures, identity/deletion guards, concurrent YAML edits, controller acknowledgment, timeout and cancellation. An isolated live namespace verified bulk suspend/resume/reconcile, acknowledged readiness, suspended-resource refusal, YAML edits and UID-guarded deletion; temporary resources were removed afterward. The upstream Storybook test remains skipped because there are no stories. The current live check parsed all 727 inventory entries across 11 Kustomizations into 22 valid namespace-grouped graphs (expanded and compact), verified every resource stays inside its namespace container, and extracted Flux-owned lines from live ConfigMaps, Services and Deployments. Live Helm resources recorded helm-controller Update ownership, which is labeled explicitly.

Inventory status is fetched on opening and on **Refresh status**. Stateless resources show **Present**, which does not imply application health. Helm release decoding is bounded to 64 MiB expanded. The diagrams show declared dependencies and recorded inventory; they do not infer application traffic or dependency health. New strings currently fall back to English when a translation is unavailable. The first draft has code-level checks and live bundle verification; an authenticated browser visual pass is still outstanding.

---

# Flux

The Flux plugin provides a way to visualize Flux (should be installed in your cluster) in Headlamp. Flux is a tool for implementing GitOps and synchronizing Kubernetes clusters with sources of configuration (like Git repositories). It also automates updates to configuration when there is new code to deploy.

This plugin adds a new item (Flux) to the sidebar to give the user an overview of the Flux installation on the cluster.

## Flux Installation

Please refer to the [official installation guide](https://fluxcd.io/flux/installation/) for Flux to learn to install it.

## Plugin Installation in Headlamp for Desktop

Go to the Plugin Catalog, search for the Flux plugin, and click the Install button. Reload the UI (Navigation menu > Reload, or use the notification after installing the plugin) to see the new Flux item in the sidebar.

## Installing the Flux Headlamp plugin in a Headlamp deployment

If you are deploying Headlamp using Helm, you can use the following HelmRelease manifest to install the Flux Headlamp plugin with your Headlamp deployment:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: headlamp
---
apiVersion: source.toolkit.fluxcd.io/v1beta1
kind: HelmRepository
metadata:
  name: headlamp
  namespace: headlamp
spec:
  interval: 1m0s
  timeout: 1m0s
  url: https://headlamp-k8s.github.io/headlamp/
---
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: headlamp
  namespace: headlamp
spec:
  chart:
    spec:
      chart: headlamp
      sourceRef:
        kind: HelmRepository
        name: headlamp
      version: '*'
  interval: 1m0s
  values:
    ingress:
      enabled: true
      ingressClassName: nginx
      annotations:
        cert-manager.io/cluster-issuer: letsencrypt-http01-nginx-issuer
      hosts:
        - host: example.com # Change me
          paths:
            - path: /
              type: ImplementationSpecific
      tls:
        - secretName: headlamp-tls
          hosts:
            - example.com # Change me
    config:
      pluginsDir: /build/plugins
    initContainers:
      - command:
          - /bin/sh
          - -c
          - mkdir -p /build/plugins && cp -r /plugins/* /build/plugins/ && chown -R 100:101 /build
        image: ghcr.io/headlamp-k8s/headlamp-plugin-flux:latest
        imagePullPolicy: Always
        name: headlamp-plugins
        securityContext:
          runAsNonRoot: false
          privileged: false
          runAsUser: 0
          runAsGroup: 0
        volumeMounts:
          - mountPath: /build/plugins
            name: headlamp-plugins
    persistentVolumeClaim:
      accessModes:
        - ReadWriteOnce
      enabled: true
      size: 1Gi
    volumeMounts:
      - mountPath: /build/plugins
        name: headlamp-plugins
    volumes:
      - name: headlamp-plugins
        persistentVolumeClaim:
          claimName: headlamp # The name of the Helm release
```

As alternative, you can also use the Use EmptyDir (Ephemeral Shared Volume) to pass files from the init containers to the main container.

```yaml
config:
  pluginsDir: /build/plugins
initContainers:
  - command:
      - /bin/sh
      - -c
      - mkdir -p /build/plugins && cp -r /plugins/* /build/plugins/ && chown -R 100:101 /build
    image: ghcr.io/headlamp-k8s/headlamp-plugin-flux:latest
    imagePullPolicy: Always
    name: headlamp-plugins
    securityContext:
      runAsNonRoot: false
      privileged: false
      runAsUser: 0
      runAsGroup: 0
    volumeMounts:
      - mountPath: /build/plugins
        name: headlamp-plugins
volumeMounts:
  - mountPath: /build/plugins
    name: headlamp-plugins
volumes:
  - name: headlamp-plugins
    emptyDir: {}
```
