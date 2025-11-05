# KubeVirt Plugin for Headlamp

The **KubeVirt Plugin** is a [Headlamp](https://headlamp.dev/) extension that adds native support for managing [KubeVirt](https://kubevirt.io/) resources directly within the Headlamp UI. It enhances your Kubernetes dashboard with intuitive views and controls for managing Virtual Machines (VMs), Virtual Machine Instances (VMIs), and other KubeVirt-related resources.

## 📋 Prerequisites
- A running Kubernetes cluster with [KubeVirt installed](https://kubevirt.io/quickstart_kind/)
- [VMs](https://kubevirt.io/user-guide/user_workloads/virtual_machine_instances/) are deployed with use of KubeVirt

## 🚀 Installation

### In-Cluster
Add an `initContainer` to the Headlamp deployment that copies the KubeVirt plugin files into a shared volume before the main Headlamp container starts.

To install Headlamp, follow the instructions [here](https://headlamp.dev/docs/latest/installation/in-cluster/).

### Desktop App
Headlamp Desktop app supports installing plugins via the Plugin Catalog.

1. Start the Headlamp app.
2. Click on "Plugin Catalog" in the sidebar.
3. Search for "KubeVirt" and install it.

For more details, refer to the [official documentation](https://headlamp.dev/docs/latest/installation/desktop/plugins-install-desktop/).

## 🎥 Demo

After applying the deployment changes, access Headlamp.

![DEMO](demo/demo-kubevirt-plugin.gif)

## 🙋 Contact
For any questions or feedback, please open an issue on the GitHub repository.
