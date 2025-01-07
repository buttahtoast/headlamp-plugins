import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import Terminal from '../Terminal/Terminal'
import VirtualMachine from './VirtualMachine';

export interface VirtualMachineDetailsProps {
  showLogsDefault?: boolean;
  name?: string;
  namespace?: string;
}

export default function VirtualMachineDetails(props: VirtualMachineDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [showTerminal, setShowTerminal] = useState(false);

  const [podName, setPodName] = useState<string | null>(null);
  useEffect(() => {
    const fetchPodName = async () => {
      try {
        const podName = await getPodName(name, namespace);
        setPodName(podName);
      } catch (error) {
        console.error('Failed to get pod name', error);
      }
    };

    fetchPodName();
  }, [name, namespace]);
  return (
    <Resource.DetailsGrid
      name={name}
      namespace={namespace}
      resourceType={VirtualMachine}
      extraInfo={item =>
        item && [
          {
            name: t('Status'),
            value: item?.jsonData.status.printableStatus,
          },
          {
            name: 'VirtualMachineInstance',
            value: (
              <Link
                routeName="/kubevirt/virtualmachinesinstances/:namespace/:name"
                params={{
                  name: item.getName(),
                  namespace: item.getNamespace(),
                }}
              >
                {item.getName()}
              </Link>
            ),
          },
          {
            name: 'Pod',
            value: (
              <Link
                routeName="pod"
                params={{
                  name: podName,
                  namespace: item.getNamespace(),
                }}
              >
                {podName}
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
                      id: 'headlamp.vm-terminal',
                      section: (
                                    <Terminal
                                      open={showTerminal}
                                      key="terminal"
                                      item={item}
                                      onClose={() => {
                                        setShowTerminal(false);
                                      }}
                                    />
                                  ),
                    },
        ]
      }
      actions={item =>
        item && [
          {
            id: 'start',
            action: (
              <ActionButton
                description={t('Start')}
                icon="mdi:play"
                onClick={() => {
                  console.log('start ' + item.getName());
                  try {
                    item.start();
                    enqueueSnackbar('Virtual Machine started', { variant: 'success' });
                  } catch (e) {
                    console.error('start failed', e);
                    enqueueSnackbar('Failed to start Virtual Machine', { variant: 'error' });
                  }
                }}
              ></ActionButton>
            ),
          },
          {
            id: 'stop',
            action: (
              <ActionButton
                description={t('Stop')}
                icon="mdi:stop"
                onClick={() => {
                  console.log('start ' + item.getName());
                  try {
                    item.stop();
                    enqueueSnackbar('Virtual Machine stopped', { variant: 'success' });
                  } catch (e) {
                    console.error('start failed', e);
                    enqueueSnackbar('Failed to stopp Virtual Machine', { variant: 'error' });
                  }
                }}
              ></ActionButton>
            ),
          },
          {
            id: 'console',
            action: (
              <Resource.AuthVisible item={item} authVerb="get" subresource="exec">
                <ActionButton
                  description={t('Terminal / Exec')}
                  aria-label={t('terminal')}
                  icon="mdi:console"
                  onClick={() => {
                    setShowTerminal(true);
                  }}
                />
              </Resource.AuthVisible>
            ),
          },
        ]
      }
    />
  );
}

async function getPodName(name: string, namespace: string): Promise<string> {
  const request = ApiProxy.request;
  const queryParams = new URLSearchParams();
  let response;
  queryParams.append('labelSelector', `vm.kubevirt.io/name=${name}`);
  try {
    response = await request(`/api/v1/namespaces/${namespace}/pods?${queryParams.toString()}`, {
      method: 'GET',
    });
  } catch (error) {
    return 'Unknown';
  }
  return response?.items[0]?.metadata?.name || 'Unknown';
}
