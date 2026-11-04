import type { PluginSettingsDetailsProps } from '@kinvolk/headlamp-plugin/lib';
import { clusterCaFieldText, currentClusterConfig, SettingsField, useButtahPrefs } from './local';

export function KubeconfigSettings(props: PluginSettingsDetailsProps) {
  void props;
  const [prefs, update, view] = useButtahPrefs();
  const clusterFile = currentClusterConfig();
  const kubeconfig = clusterFile.values.kubeconfig;
  const namespaceLocked = view.source['kubeconfig.contextNamespace'] === 'locked';

  return (
    <div className="buttah" style={{ padding: 8, background: 'transparent' }}>
      <p
        className="buttah-help"
        id="buttah-settings-cluster-config"
        data-status={view.clusterStatus}
        data-origin={clusterFile.origin}
      >
        {view.clusterStatus === 'ok' ? null : view.clusterMessage}
      </p>
      <SettingsField
        id="buttah-settings-kubeconfig-server"
        label="API server"
        value={kubeconfig.server ?? ''}
        spellCheck={false}
        disabled
        readOnly
      />
      <SettingsField
        id="buttah-settings-kubeconfig-cluster"
        label="Cluster name"
        value={kubeconfig.clusterName ?? ''}
        spellCheck={false}
        disabled
        readOnly
      />
      <SettingsField
        id="buttah-settings-kubeconfig-namespace"
        label="Context namespace"
        value={prefs.contextNamespace}
        spellCheck={false}
        placeholder="Namespace"
        disabled={namespaceLocked}
        onChange={contextNamespace => update({ contextNamespace })}
      />
      <SettingsField
        id="buttah-settings-kubeconfig-ca"
        label="Cluster CA"
        value={clusterCaFieldText(kubeconfig.server ?? '', kubeconfig.certificateAuthorityData)}
        disabled
        readOnly
      />
    </div>
  );
}
