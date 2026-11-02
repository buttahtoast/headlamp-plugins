# SSA Inspector

A dedicated Headlamp plugin for Kubernetes field ownership, extracted from the Flux inventory inspector and Capsule's GlobalTenantResource SSA view.

Open a resource detail page and click **SSA** in its header. The action appears on built-in and custom resources that use Headlamp's standard resource header, including cluster-scoped resources. It does not require Flux or Capsule, add a sidebar, install CRDs or modify resource permissions.

The viewer loads a fresh object through the signed-in user's existing cluster connection. API discovery determines the actual resource plural and scope. It supports all Apply and Update managers, a combined Apply view, combined ownership, optional status/subresource records, field highlighting within live context, and a Live YAML tab. Update ownership is labeled explicitly. API versions and timestamps are available on manager badges.

Secret values are hidden in both views until revealed. Reveal state resets when the resource or cluster changes. Closing or switching resources cancels pending inspection; replaced objects and permission errors produce a message. The plugin makes GET requests only, and loads object data when opened or refreshed.

This is a view of current values and their recorded `metadata.managedFields` ownership. It does not reconstruct historical applied manifests or perform a Git-to-live drift comparison. Some resources do not expose managed fields. New interface strings currently use English. Resource pages with fully custom headers need to adopt Headlamp's resource header hook to show the action.

## Build and live injection

Use Node 22 LTS and npm 10 or newer, from this directory:

```sh
npm ci
npm run format -- --check
npm run lint
npm run tsc
CI=1 npm test
npm run build
npm run package

HEADLAMP_CONTEXT=admin@cluster-a npm run dev:cluster -- --once
# Watch source and synchronize replacement Headlamp pods:
HEADLAMP_CONTEXT=admin@cluster-a npm run dev:cluster
```

The live script requires an explicit context and Headlamp's `-watch-plugins-changes` flag. It installs in `ssa-inspector` on every ready replica using atomic writes, SHA-256 verification and bounded retries. Optional environment variables: `HEADLAMP_KUBECONFIG`, `HEADLAMP_NAMESPACE` (default `capsule-system`), `HEADLAMP_DEPLOYMENT` (`headlamp`), `HEADLAMP_CONTAINER` (`headlamp`), `HEADLAMP_PLUGINS_DIR` (`/build/plugins`). Injection lasts for the current pods; use the watch script or a persistent plugin image to retain it across replacement.

The repository Dockerfile supports `docker build --build-arg PLUGIN=ssa .`. Headlamp's plugin package is `ssa-inspector-0.1.0-draft.1.tar.gz`.

## Shared viewer

The package exports `ssa-inspector/viewer` (`ManagerDiff`) and `ssa-inspector/model` (ownership parsing/rendering). Flux imports those modules as a local npm file dependency and bundles them into its own JavaScript. Both plugins work independently at runtime; Flux inventory shortcuts retain Flux manager defaults.

`flux/.npmrc` enables `install-links=true` so the local dependency is installed as a package copy with the consuming plugin's React dependencies. After changing the shared source, refresh that copy with `npm ci` in `../flux` before rebuilding Flux. The root Dockerfile copies the local package before installing a plugin's dependencies. No published npm package is required for repository builds.

Tests cover global header registration, arbitrary managers, Apply/Update/status selection, discovery and version fallback, cluster scope, missing permissions, UID replacement, bounded requests, cancellation, and Secret reveal isolation across resources and clusters. Capsule's field-rendering attribution is retained in NOTICE.
