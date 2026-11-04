import type { PluginSettingsDetailsProps } from '@kinvolk/headlamp-plugin/lib';
import {
  currentClusterConfig,
  type PrefKey,
  SettingsField,
  type ShellPrefs,
  useButtahPrefs,
} from './local';

export function ShellSettings(props: PluginSettingsDetailsProps) {
  void props;
  const [prefs, update, view] = useButtahPrefs();
  const shell = (partial: Partial<ShellPrefs>) => update({ shell: { ...prefs.shell, ...partial } });
  const locked = (key: PrefKey) => view.source[key] === 'locked' || view.source[key] === 'admin';
  const clusterFile = currentClusterConfig();

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
        id="buttah-settings-issuer"
        label="Issuer URL"
        value={prefs.shell.issuerUrl}
        spellCheck={false}
        disabled
        readOnly
      />
      <SettingsField
        id="buttah-settings-client"
        label="Client ID"
        value={prefs.shell.clientId}
        spellCheck={false}
        disabled
        readOnly
      />
      <SettingsField
        id="buttah-settings-scopes"
        label="Scopes"
        value={prefs.shell.scopes}
        spellCheck={false}
        disabled
        readOnly
      />
      <SettingsField
        id="buttah-settings-authorization"
        label="Authorization endpoint"
        value={prefs.shell.authorizationEndpoint}
        spellCheck={false}
        disabled
        readOnly
      />
      <SettingsField
        id="buttah-settings-token"
        label="Token endpoint"
        value={prefs.shell.tokenEndpoint}
        spellCheck={false}
        disabled
        readOnly
      />
      <SettingsField
        id="buttah-settings-image"
        label="Shell image"
        value={prefs.shell.image}
        spellCheck={false}
        placeholder="kubectl image"
        disabled={locked('shell.image')}
        onChange={image => shell({ image })}
      />
      <SettingsField
        id="buttah-settings-namespace"
        label="Shell namespace"
        value={prefs.shell.namespace}
        spellCheck={false}
        placeholder="Namespace"
        disabled={locked('shell.namespace')}
        onChange={namespace => shell({ namespace })}
      />
      <SettingsField
        id="buttah-settings-ca"
        label="Identity provider CA"
        value={prefs.shell.idpCaPem}
        spellCheck={false}
        placeholder="PEM"
        disabled
        readOnly
        multiline
      />
    </div>
  );
}
