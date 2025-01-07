import { ActionButton,Link, Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import Terminal from '../Terminal/Terminal';
import VirtualMachineInstance from './VirtualMachineInstance';

export interface VirtualMachineInstanceDetailsProps {
  showLogsDefault?: boolean;
  name?: string;
  namespace?: string;
}

export default function VirtualMachineInstanceDetails(props: VirtualMachineInstanceDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const [showTerminal, setShowTerminal] = useState(false);

  return (
    <Resource.DetailsGrid
      name={name}
      namespace={namespace}
      resourceType={VirtualMachineInstance}
      extraInfo={item =>
        item && [
          {
            name: t('Status'),
            value: item?.jsonData.status.phase,
          },
          {
            name: 'VirtualMachine',
            value: (
              <Link
                routeName="/kubevirt/virtualmachines/:namespace/:name"
                params={{
                  name: item.getName(),
                  namespace: item.getNamespace(),
                }}
              >
                {item.getName()}
              </Link>
            ),
          },
        ]
      }
      extraSections={item =>
        item && [
          {
            id: 'status',
            section: <Resource.ConditionsSection resource={item?.jsonData} />,
          },
          {
            id: 'vm-terminal',
            section: (
              <Terminal
                open={showTerminal}
                key="terminal"
                item={item}
                onClose={() => setShowTerminal(false)}
              />
            ),
          },
        ]
      }
      actions={item =>
        item && [
          {
            id: 'console',
            action: (
              <Resource.AuthVisible item={item} authVerb="get" subresource="exec">
                <ActionButton
                  description={t('Terminal / Exec')}
                  aria-label={t('terminal')}
                  icon="mdi:console"
                  onClick={() => setShowTerminal(true)}
                />
              </Resource.AuthVisible>
            ),
          },
        ]
      }
    />
  );
}
