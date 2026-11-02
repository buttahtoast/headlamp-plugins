# Cleaner for Headlamp

A first-draft Headlamp plugin for [k8s-cleaner](https://gianlucam76.github.io/k8s-cleaner/getting_started/install/install/). It lives in its own directory and is built independently of the other plugins in this repository.

## Features

- Overview of all Cleaner policies, including policies without reports, with action, cron schedule, last/next run, failures, and reported match counts.
- Latest reports with policy search and resource filtering by kind, namespace, name, or message.
- Full YAML for each captured resource, decoded from `fullResource` and displayed with all saved metadata and status.
- Interactive XYFlow diagrams in the Capsule plugin's style: Report → matching resources, with kind and namespace on each resource card, counts, pan/zoom controls, and captured YAML.
- Policy details with resource selectors, label filters, Lua evaluation/aggregation/transformation code, and copy controls.
- Create and edit policies using Headlamp's YAML editor; delete a policy with confirmation.
- Three editable starter recipes: completed Jobs, failed Pods, and unavailable Deployments. Each defaults to `Scan`, the `default` namespace, and a `CleanerReport` notification.
- Run one or all policies through the Cleaner dashboard API.
- Restore a selected resource directly from its Report snapshot through Kubernetes, with a manifest preview and confirmation. Dashboard access is not needed for rollback.
- Native Headlamp headers, resource metadata, sortable/paginated tables, theme support, cluster selection, and authenticated API access.
- Conditions and Events side by side on policy/report details, stacked on smaller screens. Report YAML and matching-resource YAML/restore actions are available through the standard three-dot menus.

This is a draft, not full parity with the upstream dashboard. Recipes contains three bundled starters rather than the upstream recipe catalog. Reports are current snapshots, not execution history. Lua is displayed as copyable source, without syntax highlighting.

## Requirements

- Headlamp v0.45.0 (the development instance), built with `@kinvolk/headlamp-plugin` 0.14.0.
- k8s-cleaner `apps.projectsveltos.io/v1alpha1` CRDs: cluster-scoped `Cleaner` (`cleaners`) and `Report` (`reports`). Development uses controller v0.24.0.
- Node.js 22 LTS and npm 10 or later for development.

Reading resources, editing policies, and restoring Report snapshots use the Kubernetes API. Only manual runs additionally require the k8s-cleaner dashboard (`web.enabled=true`), reachable through the Kubernetes service proxy. Under **Connection**, configure the namespace, service, and port. Defaults are `k8s-cleaner / k8s-cleaner-web / 9080`; settings are stored per cluster in this browser.

The Recipes and Reports pages do not contact the dashboard service or show dashboard connection warnings. Recipes uses bundled templates at `/cleaner/recipes`; previous `/cleaner/library` bookmarks remain supported. Users without Cleaner permissions can preview recipe YAML; creating a policy requires Kubernetes permission to create a Cleaner. Scheduled execution is handled by the controller and does not require dashboard proxy access from the user.

Manual runs use the dashboard trigger endpoint:

```text
POST /api/v1/cleaners/{name}/trigger
```

The trigger is accessed through `/api/v1/namespaces/{namespace}/services/http:{service}:{port}/proxy`. Dashboard read-only mode disables manual runs. Policy edits and snapshot restores follow the user's Kubernetes RBAC independently.

### Inspect report resources

Each Report detail page uses Headlamp's resource metadata layout and a **Matching resources** section. Its XYFlow diagram follows the Capsule plugin's relationship flows: a blue source card, themed resource cards, animated connections, a dotted canvas, and pan/zoom/fit controls. The Report connects directly to each matching resource. Each card displays its kind, name, and namespace (or cluster/unknown scope); the kind tooltip includes its API version. Reduced-motion preferences disable edge animation.

The diagram shows up to eight matches per page, with **Previous resources** and **Next resources** controls for larger reports. Summary counts cover the whole report. The searchable table below contains every entry and uses Headlamp's sorting and pagination. These relationships describe report entries, not live ownership or current resource existence.

Choose **Full YAML** from a matching resource’s actions menu or a captured resource card to inspect the decoded snapshot. This preserves the entire saved object, including `status`, `uid`, `resourceVersion`, and `managedFields`. The viewer has no save action. Missing snapshots disable the menu actions; corrupt snapshots show an error. Viewing captured YAML only requires access to the Report and makes no dashboard or target-resource requests.

Screenshots: [Full YAML](demo/full-resource-yaml.png), [resource diagram](demo/resource-flow.png), and [dark theme](demo/resource-flow-dark.png). Diagram screenshots use browser-only test fixtures.

### Restore a saved resource

Open the Report named after the Cleaner, find the resource, and choose **Restore** from its actions menu. The plugin fetches that Report again, decodes the selected `spec.resourceInfo[].fullResource` (base64-encoded UTF-8 JSON), and shows the manifest before confirmation.

The resource kind is resolved using Kubernetes API discovery. Missing objects are recreated with POST; existing objects are restored with PUT and the reviewed `resourceVersion`. Server-generated metadata and captured status are removed; existing objects retain their current status. This restores the saved configuration, including removing fields added by a transformation. It does not call the dashboard or change the Cleaner schedule.

The user needs `get` on the Report, API discovery access, and `get` plus `create` or `update` on the target resource. No service-proxy role is required. A changed report, a concurrent resource update, or a different object occupying the same name stops the restore. Kubernetes validation, immutable-field, and permission errors are surfaced without deleting the resource or forcing an overwrite. Only captured resources from Delete/Transform reports can be restored; Scan reports have no rollback action.

The snapshot restores the Kubernetes object configuration, not external data such as the contents of a deleted volume. The Cleaner schedule remains active and can act on a restored resource again.

## Live development

To use an existing kubeconfig explicitly:

```sh
cd cleaner
npm ci
HEADLAMP_KUBECONFIG="$HOME/.kube/cluster-a" npm run dev:cluster
```

This uses the selected file directly, preserving credential refreshes and leaving its contents and current context unchanged. The watcher prints the selected context and target deployment. It does not invoke kind when `HEADLAMP_KUBECONFIG` is set.

Alternatively, obtain a temporary kubeconfig from kind:

```sh
cd cleaner
npm ci
npm run dev:kind
```

The development script:

1. Uses `HEADLAMP_KUBECONFIG` when provided, otherwise obtains a temporary kubeconfig directly from the named kind cluster. It does not fall back to the shell's current context.
2. Builds the plugin in watch mode.
3. Copies `package.json` and atomically replaces `main.js` in `/build/plugins/cleaner` of the ready Headlamp pod.
4. Retries failed syncs and reinstalls the plugin if the pod is replaced or its startup installer removes the synced files.

By default it targets kind cluster `capsule`, namespace `capsule-system`, deployment/container `headlamp`. Override these without changing other plugins:

```sh
KIND_CLUSTER=my-kind HEADLAMP_NAMESPACE=headlamp npm run dev:kind
```

`HEADLAMP_DEPLOYMENT` and `HEADLAMP_CONTAINER` are also supported. The Headlamp container must have a writable `/build/plugins` volume and the `-watch-plugins-changes` argument. For Helm, set `config.watchPlugins: true`. In the current Flux playground, enable it with:

```sh
kind get kubeconfig --name capsule > /tmp/headlamp-cleaner-kind.yaml
chmod 600 /tmp/headlamp-cleaner-kind.yaml
kubectl --kubeconfig /tmp/headlamp-cleaner-kind.yaml -n flux-system patch helmrelease headlamp \
  --type merge -p '{"spec":{"values":{"config":{"watchPlugins":true}}}}'
```

For a lasting playground configuration, also set that value in the source managed by Flux. A later source reconciliation can replace manual HelmRelease changes.

Open [Cleaner in the kind Headlamp](https://headlamp.capsule.local/c/main/cleaner) and sign in with a user that can access the Cleaner resources. Headlamp reloads on a subsequent API request when the bundle changes; Cleaner polls resources every five seconds. A manual refresh may be needed after the first installation. Stop the watcher with Ctrl+C. Synced files remain in the pod's volume; they are temporary if that volume is `emptyDir`.

### Example resources

`dev/demo.yaml` creates an isolated `cleaner-demo` namespace, two example ConfigMaps, and two **Scan-only** policies. It never configures Delete or Transform. With k8s-cleaner installed:

```sh
kubectl --kubeconfig /tmp/headlamp-cleaner-kind.yaml apply -f dev/demo.yaml
```

The policies run every five minutes, or use **Run now** in the plugin. The ConfigMap report should contain two matches; the failed-Pod report should be empty. Remove the demo with `kubectl --kubeconfig /tmp/headlamp-cleaner-kind.yaml delete -f dev/demo.yaml`; this deletes the isolated demo namespace and its contents. Reports may remain because upstream does not attach owner references; delete the two `headlamp-demo-*` Reports explicitly if needed.

### Sample Jobs

After applying `dev/demo.yaml`, add the Job scenarios using the selected kubeconfig:

```sh
kubectl --kubeconfig "$HOME/.kube/cluster-a" apply -f dev/jobs.yaml
```

| Jobs | Expected state | Cleaner report |
| --- | --- | --- |
| `demo-nightly-report`, `demo-cache-refresh`, `demo-data-export` | Complete | `headlamp-demo-completed-jobs`: 3 matches |
| `demo-broken-import` | Failed intentionally, no retries | `headlamp-demo-failed-jobs`: 1 match |
| `demo-paused-maintenance` | Suspended, no Pod created | Excluded from both Job reports |

The existing failed-Pod policy also finds the broken import's Pod. All policies use **Scan**; the Jobs remain available for inspection, with no active Job Pods after completion. The completed-Job selector checks the `Complete=True` condition so a partially completed Job is not mistaken for a finished one.

Open [Cleaner](https://headlamp.capsule.local/c/main/cleaner), select either Job policy, and choose **Run now**. Follow **Inspect resources** to see the report and filter its rows. Policies also scan every five minutes. Compare the [completed-Job report](https://headlamp.capsule.local/c/main/cleaner/reports/headlamp-demo-completed-jobs) with the [failed-Job report](https://headlamp.capsule.local/c/main/cleaner/reports/headlamp-demo-failed-jobs).

Screenshots from the live instance: [overview](demo/jobs-overview.png), [completed Jobs](demo/completed-jobs-report.png), [failed Job](demo/failed-jobs-report.png), and [admin OIDC overview](demo/admin-overview.png).

The [recipe editor](demo/recipe-editor.png) uses a bounded, responsive dialog layout. This works around Headlamp v0.45.0 collapsing Monaco to a five-pixel strip inside an editor tab; the styles apply only to this plugin's editor dialogs. Normal, fullscreen, minimal, read-only, and narrow-screen layouts were checked against the live instance.

To remove only the Job scenarios (retaining the namespace and ConfigMap demos):

```sh
kubectl --kubeconfig "$HOME/.kube/cluster-a" delete -f dev/jobs.yaml
kubectl --kubeconfig "$HOME/.kube/cluster-a" delete reports.apps.projectsveltos.io \
  headlamp-demo-completed-jobs headlamp-demo-failed-jobs --ignore-not-found
```

The failed-Pod report clears on its next scan after the failed Job's Pod is removed. Applying the Job manifest again leaves existing completed Jobs unchanged; remove the Job scenarios first if you want to rerun their containers.

The documented upstream OCI chart download returned HTTP 403 during initial setup. The development cluster was installed from the inspected upstream chart at commit `811f7cc8d333d49af536dd9fb43f5c75bfc4b67e`, with controller image `projectsveltos/k8s-cleaner:v0.24.0` and `web.enabled=true`.

## Permissions and behavior

`dev/rbac.yaml` provides unbound viewer/editor roles and a namespace-scoped dashboard operator role. Adapt and bind them to the intended identities; the plugin does not grant privileges or install RBAC bindings.

`dev/alice-rbac.yaml` is a prepared development-only grant for the playground's `alice` identity. It grants cluster-scoped Cleaner/report reads, read access to the demo namespace's Jobs/Pods/ConfigMaps and Pod logs, and access to the specific Cleaner dashboard service proxy. It has **not been applied**; the operator grant requires explicit approval because dashboard actions run with the controller's permissions and are not restricted to the sample resources. Applying the demo resource manifests alone does not grant a tenant login access to them.

The UI distinguishes dashboard access denied (403) from service/configuration errors. Missing read permissions are shown explicitly instead of implying that no policies exist. After an administrator changes RBAC, refresh Headlamp to refresh its cached authorization checks.

The local playground login `admin@projectcapsule.dev` maps to Kubernetes user `admin`, which already has cluster-admin access. A fresh OIDC browser session was verified to show all four demo policies, four reports, and seven reported matches with manual actions enabled. If an existing tab still shows Alice's access errors after switching accounts, reload the page and check the username in Headlamp's account menu.

Dashboard service proxy access grants access to the controller's API, which operates with controller permissions. Treat that role as operator access: Kubernetes RBAC cannot restrict the downstream dashboard URL paths. Do not grant it to report-only users. Resource reads, policy edits, and snapshot restores use the signed-in user's normal Kubernetes permissions. UI permission checks fail closed, and server errors remain visible.

New policies require an explicit action because the upstream CRD defaults a missing action to **Delete**. Manual runs execute the policy's configured action; “Run now” is not necessarily a dry run. Rollback is offered per resource in a non-Scan report containing captured `fullResource` data. Enabling `spec.rollback` also requires a `CleanerReport` notification upstream.

Upstream keeps one Report named after each Cleaner and overwrites it on subsequent runs. The plugin does not use report creation time as an execution time. The displayed **Last scheduled run** comes from Cleaner status; manual dashboard scans update reports without updating that scheduling timestamp. The overview's total is a sum of reported matches, which may overlap across policies. Missing reports and inaccessible reports are not represented as zero matches.

## Build and validate

```sh
npm run lint
npm run tsc
npm test
npm run build
npm run package
```

The build produces `dist/main.js`; packaging produces `cleaner-0.1.0.tar.gz`. Install the extracted `cleaner` directory into Headlamp's plugins directory, or build the repository's per-plugin container from the repository root:

```sh
docker build --build-arg PLUGIN=cleaner -t headlamp-cleaner:dev .
```

The existing repository CI discovers this plugin through its `package.json`. Each plugin retains its own dependency lockfile and release version.

Live validation on Headlamp v0.45.0 and Cleaner v0.24.0 covered policy details, Lua display, manual Scan runs, report contents and filtering, disabled rollback for Scan reports, and creating/editing/deleting a temporary policy through the native YAML editor. The source watcher rebuilt and synced the editor integration fix during that verification. That initial validation used four Scan-only demo policies and five sample Jobs. Real OIDC sessions also verified Alice's permission warnings and the admin account's policy cards and report counts.

Recipes validation covered all three recipe dialogs, viewport resizing, fullscreen, minimal editing, the diff view, and the save confirmation without creating a resource. Both admin and Alice sessions made no dashboard proxy requests on the Recipes page. Closing Headlamp's native diff editor can log `TextModel got disposed before DiffEditorWidget model got reset`; subsequent previews and save confirmations still worked in this check.

Kubernetes-only rollback was validated after the local playground reset on 2026-10-09. Only the Cleaner CRDs and isolated fixtures were added; no Cleaner controller or dashboard was installed for that check. The fixtures are two explicitly annotated Reports (`headlamp-rollback-demo-transform`, `headlamp-rollback-demo-delete`) and ConfigMaps in `cleaner-rollback-demo`. They contain manually seeded snapshots, not records of actual controller mutations. The browser check covers restoring a transformed ConfigMap, recreating an absent ConfigMap, preserving UTF-8 content, rejecting concurrent resource/report changes, and making zero service-proxy requests.

Report-view browser validation checked the real snapshot against the displayed YAML, then used browser-only responses for multiple namespaces/kinds, cluster scope, zoom/fit controls, light/dark themes, missing/corrupt snapshots, captured status/metadata, a paged 35-resource graph, empty reports, and narrow screens. Report checks made no resource writes or service-proxy requests. Additional browser checks covered Headlamp's policy/report metadata, policy search, and the Recipes editor without resource mutations.

The Recipes rename and report menus were checked in the live browser, including the old Library URL, report YAML, resource YAML, disabled actions for missing snapshots, and populated Conditions/Events from browser-only responses. Event queries were verified to select the Report's name and kind. No cluster resources or permissions were changed.
