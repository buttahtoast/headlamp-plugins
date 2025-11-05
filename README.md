# Headlamp Plugins Repository

This repository contains various plugins for [Headlamp](https://headlamp.dev/), a Kubernetes web UI. The plugins extend Headlamp's functionality for specific use cases.

## Available Plugins
- **KubeVirt**: Adds support for managing KubeVirt resources like Virtual Machines and Instances.
- **Capsule**: (Placeholder - under development)
- **SSH Proxy**: (Placeholder - under development)
- **Web Proxy**: (Placeholder - under development)

## Installing Plugins

### In-Cluster

In an [In-Cluster](https://headlamp.dev/docs/latest/installation/in-cluster/) scenario, you can install plugins in two ways.

#### initContainer

Use an initContainer to copy built plugins from a custom image to a shared volume mounted in the Headlamp container.

```yaml
initContainers:
  - name: headlamp-plugins
    image: your-plugins-image:latest
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
