# Headlamp Plugins Repository

This repository contains various plugins for [Headlamp](https://headlamp.dev/), a Kubernetes web UI. The plugins extend Headlamp's functionality for specific use cases.

## Available Plugins

- **[SSA Inspector](ssa/README.md)**: Inspect Apply/Update field ownership on Kubernetes resource detail pages, with any manager and optional status ownership.
- **[Flux](flux/README.md)**: Flux GitOps dashboard, list statistics and interactive Kustomization/HelmRelease inventory diagrams.
- **[Velero](velero/README.md)**: Manage backups, schedules, storage and restores; inspect archives, compare objects, and recover individual resources.
- **[Cleaner](cleaner/README.md)**: Manage k8s-cleaner policies, latest reports, Lua selectors, manual runs, and rollback. Includes a live development workflow for kind.
- **KubeVirt**: Adds support for managing KubeVirt resources like Virtual Machines and Instances.
- **SSH Proxy**: (Placeholder - under development)
- **Web Proxy**: (Placeholder - under development)

The old Capsule and kubeconfig-oidc plugins have been removed from this repository.

## Releases

Pull requests and pushes to `main` validate every plugin using Capsule's shared
[`headlamp-test`](https://github.com/projectcapsule/github-actions/tree/main/headlamp-test)
action, following the approach in
[`projectcapsule/change-windows`](https://github.com/projectcapsule/change-windows).
These builds do not publish anything.

Pushing a tag such as `v0.1.0` releases **all five plugins** at version `0.1.0`.
The workflow stamps the package and lockfile versions in its checkout, including
Flux's local SSA dependency; it does not commit these changes back to the source
branch. All plugin checks must pass before publication starts.

| Plugin | Release archive | Container image | Plugin directory in image |
| --- | --- | --- | --- |
| Cleaner | `cleaner-<version>.tar.gz` | `ghcr.io/buttahtoast/headlamp-plugins/cleaner` | `/plugins/cleaner` |
| Flux | `headlamp-k8s-flux-<version>.tar.gz` | `ghcr.io/buttahtoast/headlamp-plugins/flux` | `/plugins/headlamp_flux` |
| KubeVirt | `kubevirt-<version>.tar.gz` | `ghcr.io/buttahtoast/headlamp-plugins/kubevirt` | `/plugins/kubevirt` |
| SSA Inspector | `ssa-inspector-<version>.tar.gz` | `ghcr.io/buttahtoast/headlamp-plugins/ssa` | `/plugins/ssa-inspector` |
| Velero | `velero-<version>.tar.gz` | `ghcr.io/buttahtoast/headlamp-plugins/velero` | `/plugins/velero` |

The workflow packages the checked bundles once and uses those artifacts for the
GitHub release and the `linux/amd64` and `linux/arm64` container images. Images are
tagged with the version, the full Git tag, and `sha-<commit>`. Stable versions also
update `latest`; prerelease tags such as `v0.1.0-rc.1` create GitHub prereleases
without changing `latest`.

After every image succeeds, the workflow publishes one GitHub release containing
all plugin archives and `SHA256SUMS`. Capsule's shared
[`headlamp-publish`](https://github.com/projectcapsule/github-actions/tree/main/headlamp-publish)
action then publishes versioned Artifact Hub metadata on the `artifacthub` branch,
reusing the released archives. Metadata writes run one at a time. Register that
branch in Artifact Hub; the root `artifacthub-repo.yml` supplies repository ownership.
Each plugin's `artifacthub.template.yml` supplies its catalog description.

Commit and push the plugin sources and workflow before tagging:

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

Use a new version for changes to an already published release. If publication
fails while the release is still a draft, rerun failed jobs. If only the Artifact
Hub step fails, rerun that step to reuse the existing release archives.

## Installing Plugins

### In-Cluster

In an [In-Cluster](https://headlamp.dev/docs/latest/installation/in-cluster/) scenario, you can install plugins in two ways.

#### initContainer

Use an initContainer to copy built plugins from a custom image to a shared volume mounted in the Headlamp container.

```yaml
initContainers:
  - name: headlamp-plugins
    image: ghcr.io/buttahtoast/headlamp-plugins/flux:0.1.0
    command: ["/bin/sh", "-c", "cp -r /plugins/* /build/plugins/"]
    volumeMounts:
      - name: headlamp-plugins
        mountPath: /build/plugins
volumes:
  - name: headlamp-plugins
    emptyDir: {}
volumeMounts:
  - name: headlamp-plugins
    mountPath: /build/plugins
config:
  pluginsDir: /build/plugins
```

#### Image Volume

Mount plugins from a pre-built image using a volume and initContainer to copy files.

### Desktop App

Headlamp Desktop app supports installing plugins via the Plugin Catalog.

1. Start the Headlamp app.
2. Click on "Plugin Catalog" in the sidebar.
3. Search for the desired plugin and install it.

For more details, refer to the [official documentation](https://headlamp.dev/docs/latest/installation/desktop/plugins-install-desktop/).

## Contact

For questions or feedback, open an issue on the [GitHub repository](https://github.com/buttahtoast/headlamp-plugins).
