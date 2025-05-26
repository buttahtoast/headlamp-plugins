# KubeVirt Plugin for Headlamp
The **KubeVirt Plugin** is a [Headlamp](https://headlamp.dev/) extension that adds native support for managing [KubeVirt](https://kubevirt.io/) resources directly within the Headlamp UI. It enhances your Kubernetes dashboard with intuitive views and controls for managing Virtual Machines (VMs), Virtual Machine Instances (VMIs), and other KubeVirt-related resources.


## 📋 Prerequisites
- A running Kubernetes cluster with [KubeVirt installed](https://kubevirt.io/quickstart_kind/)
- [VMs](https://kubevirt.io/user-guide/user_workloads/virtual_machine_instances/) are deloyed with use of KubeVirt

## 🚀 Installation Steps (On-Cluster Setup)
Add an `initContainer` to the Headlamp deployment that copies the KubeVirt plugin files into a shared volume before the main Headlamp container starts.

To install Headlamp, follow the instructions [here](https://headlamp.dev/docs/latest/installation/in-cluster/).

Before headlamp installation, update your manifest files or Helm values with the [these](./headlamp-values/) configuration.

## 🎥 Demo

After applying the deployment changes, access Headlamp.

<div align="center">
  <img src="https://raw.githubusercontent.com/buttahtoast/headlamp-plugins/bf/video-render/kubevirt/demo/demo-kubevirt-plugin.gif" width="80%">
</div>

## 🙋 Contact
For any questions or feedback, please open an issue on the GitHub repository.
