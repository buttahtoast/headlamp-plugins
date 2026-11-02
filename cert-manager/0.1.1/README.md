# cert-manager

A Headlamp operations plugin for cert-manager, with the dashboard layout used by this repository's Flux plugin. Open **Certificates → Overview** for certificate readiness, expiry risk, renewal progress, issuer health, namespace summaries and resource shortcuts. The certificate expiry table appears above issuer health.

## Certificate operations

- Create DNS certificates using an Issuer or ClusterIssuer, with Kubernetes permission checks, server dry-run and manifest review.
- Renew from a certificate row or details page. Renewal uses the same `Issuing=True / ManuallyTriggered` status condition as [cmctl renew](https://github.com/cert-manager/cmctl/blob/master/pkg/renew/renew.go). It preserves other conditions and the TLS Secret, checks `patch` permission on `certificates/status`, and server dry-runs the exact patch before review. UID and resource-version tests reject stale or replaced targets. Certificates already issuing cannot be renewed again.
- Renewal monitoring polls every three seconds for up to five minutes and requires a new ready revision or changed expiry. Request submission alone is not success. Closing the dialog or navigating away ends monitoring; accepted issuance continues in the cluster.
- View and edit YAML, delete using Headlamp's standard resource actions, export portable YAML, inspect conditions/events, navigate to the TLS Secret, and trace owned CertificateRequests → Orders → Challenges. The plugin itself does not fetch Secret data.
- Lists and detail pages cover Certificates, Issuers, ClusterIssuers, CertificateRequests, Orders and Challenges. External issuer references remain visible; the creation form supports cert-manager's built-in Issuers.

## Certificate relationship diagram

Open **Relationships** from a certificate table row or the certificate's detail header to display the interactive diagram in a large dialog. Each Certificate detail page also includes the diagram above its lifecycle fields. It shows the Certificate's owner (such as an Ingress or Gateway), Issuer or ClusterIssuer, retained CertificateRequests (CSRs), their ACME Orders and Challenges, the output TLS Secret, the next private-key Secret when present, and the issuer's CA-key or ACME-account Secret reference. Resource names link to their detail pages. Pan, zoom and the minimap help inspect larger chains; the Resources tab lists every node and its incoming/outgoing relations.

Certificate detail pages use the opened resource's namespace, independently of the overview's namespace filter while honoring allowed namespaces. The graph can use the Certificate loaded by Headlamp's native details view even when listing Certificates is forbidden. Inline and dialog diagrams have unique React Flow IDs so they can render together.

The default view includes all retained revisions. Use **CertificateRequest revision** to focus on a particular issuance. Ownership follows UID references within the same cluster and namespace, so resources from a replaced Certificate are not joined by name. Requests with a certificate-name annotation and no Certificate owner are shown as explicit annotation associations. Dashed arrows distinguish declared references and annotation associations from ownership. Health comes from loaded objects' current conditions; unavailable or missing issuers remain visible. Secret references are labeled **Reference** and do not imply existence or readiness. Secret contents are never fetched. ClusterIssuer Secret namespaces depend on controller configuration and are left unresolved rather than guessed. External issuers are shown with their actual group and kind without inventing a resource route.

Only retained and visible resources can be drawn: [cert-manager creates Orders and Challenges for ACME issuance](https://cert-manager.io/docs/concepts/acme-orders-challenges/), and older objects may have been removed. Failed or unavailable collections show an incomplete-visibility warning. Diagrams are capped at 160 nodes; the Resources tab retains all nodes and relations, and selecting a revision narrows the diagram.

## Expiry and visibility

Expiry is independent of readiness: a `Ready=True` certificate may still be expiring. Expired certificates are red; expiry within seven days is critical; the warning horizon is selectable at 14, 30, 60 or 90 days (default 30). Missing or invalid `status.notAfter` is **Unknown expiry**, never healthy. The table puts unknown expiry first, followed by earliest expiry, and shows exact local dates, `renewalTime`, overdue renewal and current issuance.

Search covers names, namespaces, clusters, DNS names, Secrets, issuers and condition messages. Dashboard summaries use the same namespace/tenant and search scope as the tables. The Show certificates filter narrows the certificate table while the cards retain the search-scoped totals. ClusterIssuers are cluster-scoped.

Selected clusters and Headlamp's namespace filters are supported. Configured allowed namespaces bound namespaced requests; disjoint selected/allowed namespaces never fall back to a cluster-wide query. Lists use paginated snapshots, at most six concurrent requests and a 20-second collection deadline, with progressive results and automatic refresh 30 seconds after completion. Refresh preserves the previous snapshot until each collection returns. Scope changes cancel stale work. Failed or unavailable APIs explicitly show **Partial visibility**.

This reports cert-manager's recorded Certificate status, not endpoint TLS probes, unmanaged Secrets, trust-chain validation or historical metrics. New UI strings are currently English.

## Build and live injection

```sh
cd cert-manager
npm ci
npm run tsc
npm run lint
npm test
npm run build
npm run package

HEADLAMP_CONTEXT='topf@cluster-a' \
HEADLAMP_KUBECONFIG='/Users/pariah/Projects/Development/infrastructure/targets/stackv2/cluster-a/topf/kubeconfig' \
npm run dev:cluster -- --once
```

Omit `--once` to watch source changes and synchronize ready replicas. Settings: `HEADLAMP_NAMESPACE` (default `capsule-system`), `HEADLAMP_DEPLOYMENT` (`headlamp`), `HEADLAMP_CONTAINER` (`headlamp`), `HEADLAMP_PLUGINS_DIR` (`/build/plugins`). An explicit context is required; the script leaves the kubeconfig unchanged.

Injection installs in `headlamp_cert-manager`, replacing the upstream cert-manager plugin in each ready Headlamp pod so there is one Certificates menu. Headlamp must enable `-watch-plugins-changes` and use a writable plugin volume. Writes are atomic and verified with SHA-256, with bounded retries. Existing files are backed up once per pod at `/tmp/headlamp-cert-manager-original`. Reload Headlamp after injection.

Live injection is ephemeral. Pod replacement or a plugin-manager reinstall can restore the upstream bundle. Keep the watcher running while developing, or install a persistent image using `docker build --build-arg PLUGIN=cert-manager .`. The existing repository workflow discovers this plugin automatically, packages it, and installs its image payload at `/plugins/headlamp_cert-manager`.

## Verification

Unit and rendering tests cover expiry boundaries, unknown expiry, current-generation conditions, overdue renewal, owner relationships, permission failures, dry-runs, object identity and resource-version guards, pagination, concurrency, scope cancellation, partial visibility, search and renewal controls.

The relationship diagram adds tests for complete ACME chains, old and current revisions, namespace/cluster/UID boundaries, annotation-only associations, missing and unavailable issuers, external issuers, ClusterIssuer scope, owner and Secret references, deterministic layouts, bounded diagrams, resource navigation and revision filtering. Detail-page regression tests mount React Flow, open the header action's dialog, check simultaneous diagram IDs, and verify the native-resource fallback and resource namespace scope. On 2026-11-02, all 39 tests, lint, type checks and the production build passed. The graph model was also checked against all 57 live Certificates, connecting 54 CertificateRequests, 44 Orders and two Challenges, with valid edge endpoints and no overlapping cards.

Validated on `topf@cluster-a` on 2026-11-01: type checking, lint, all 24 tests, production build, UMD registration and release packaging passed. The live collector found 57 Certificates, 18 Issuers, one ClusterIssuer, 54 CertificateRequests, 44 Orders, two Challenges and all three controllers. An isolated certificate renewed from revision 1 to 2, and a stale renewal patch was rejected; its namespace and generated resources were removed. Both Headlamp replicas served the exact injected bundle over HTTP, verified against its SHA-256. An authenticated browser visual pass remains outstanding because no browser was available in the session.

The optional live smoke check creates an isolated namespace, a SelfSigned Issuer and a one-hour Certificate; exercises the actual API/model code through `kubectl proxy`; verifies create, issuance, dry-run, manual renewal, a new ready revision and rejection of a stale patch; then deletes the test namespace and its resources. It never renews an existing application certificate:

```sh
HEADLAMP_CONTEXT='topf@cluster-a' \
HEADLAMP_KUBECONFIG='/Users/pariah/Projects/Development/infrastructure/targets/stackv2/cluster-a/topf/kubeconfig' \
node scripts/smoke-cluster.mjs
```

Read permissions: `get/list/watch` for the six resource types above and Events for native resource details. Renewal needs `get` on Certificates and `patch` on `certificates/status`; create needs `create` on Certificates. Kubernetes remains authoritative for every operation. No extra service account, cluster role or privileged backend is installed.
