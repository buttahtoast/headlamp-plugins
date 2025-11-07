import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Chip } from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import Terminal from '../Terminal/Terminal';
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
  const [nodeName, setNodeName] = useState<string | null>(null);
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const info = await getPodInfo(name, namespace);
        setPodName(info.podName);
        setNodeName(info.nodeName);
      } catch (error) {
        console.error('Failed to get pod info', error);
      }
    };

    fetchInitial();

    const queryParams = new URLSearchParams();
    queryParams.append('labelSelector', `vm.kubevirt.io/name=${name}`);
    queryParams.append('watch', 'true');
    const url = `/api/v1/namespaces/${namespace}/pods?${queryParams.toString()}`;

    const onStream = (result, disconnect, error) => {
      if (error) {
        console.error('Stream error:', error);
        disconnect();
        return;
      }

      const event = result;
      if (event.type === 'ADDED' || event.type === 'MODIFIED') {
        const pod = event.object;
        setPodName(pod.metadata.name);
        setNodeName(pod.spec.nodeName || 'Unknown');
      } else if (event.type === 'DELETED') {
        setPodName('Unknown');
        setNodeName('Unknown');
      }
    };

    const { cancel: cancelPod } = ApiProxy.stream(url, onStream, { isJson: true });
    return () => {
      cancelPod();
    };
  }, [name, namespace]);
  return (
    <Resource.DetailsGrid
      name={name}
      namespace={namespace}
      resourceType={VirtualMachine}
      withEvents
      extraInfo={item =>
        item
          ? [
              {
                name: t('Status'),
                value: (
                  <Chip
                    label={item?.jsonData.status.printableStatus || 'Unknown'}
                    color={getStatusColor(item?.jsonData.status.printableStatus || 'Unknown')}
                    variant="outlined"
                  />
                ),
              },
              {
                name: 'VirtualMachineInstance',
                value: (
                  <Link
                    routeName="/kubevirt/virtualmachinesinstances/:namespace/:name"
                    params={{ name: item.getName(), namespace: item.getNamespace() }}
                  >
                    {item.getName()}
                  </Link>
                ),
              },
              {
                name: 'Pod',
                value:
                  podName && podName !== 'Unknown' ? (
                    <Link
                      routeName="pod"
                      params={{
                        name: podName,
                        namespace: item.getNamespace(),
                      }}
                    >
                      {podName}
                    </Link>
                  ) : (
                    'Unknown'
                  ),
              },
              {
                name: 'Node',
                value:
                  nodeName && nodeName !== 'Unknown' ? (
                    <Link routeName="node" params={{ name: nodeName }}>
                      {nodeName}
                    </Link>
                  ) : (
                    'Unknown'
                  ),
              },
            ]
          : null
      }
      extraSections={item =>
        item
          ? [
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
          : null
      }
      actions={item => {
        if (!item) return [];
        const printableStatus = item.jsonData.status?.printableStatus || '';
        const conditions = item.jsonData.status?.conditions || [];
        const isPaused =
          conditions.some(c => c.type === 'Paused' && c.status === 'True') ||
          printableStatus === 'Paused';
        const isRunning = printableStatus === 'Running' && !isPaused;

        const actionsList = [];

        if (!isRunning && !isPaused) {
          actionsList.push({
            id: 'start',
            action: (
              <ActionButton
                description={t('Start')}
                icon="mdi:play"
                onClick={() => {
                  item
                    .start()
                    .then(() =>
                      enqueueSnackbar(t('Virtual Machine started'), { variant: 'success' })
                    )
                    .catch(e => {
                      console.error('Start failed', e);
                      enqueueSnackbar(t('Failed to start Virtual Machine'), { variant: 'error' });
                    });
                }}
              />
            ),
          });
        }

        if (isRunning || isPaused) {
          actionsList.push({
            id: 'stop',
            action: (
              <ActionButton
                description={t('Stop')}
                icon="mdi:stop"
                onClick={() => {
                  item
                    .stop()
                    .then(() =>
                      enqueueSnackbar(t('Virtual Machine stopped'), { variant: 'success' })
                    )
                    .catch(e => {
                      console.error('Stop failed', e);
                      enqueueSnackbar(t('Failed to stop Virtual Machine'), { variant: 'error' });
                    });
                }}
              />
            ),
          });
        }

        if (isRunning) {
          actionsList.push({
            id: 'pause',
            action: (
              <ActionButton
                description={t('Pause')}
                icon="mdi:pause"
                onClick={() => {
                  item
                    .pause()
                    .then(() =>
                      enqueueSnackbar(t('Virtual Machine paused'), { variant: 'success' })
                    )
                    .catch(e => {
                      console.error('Pause failed', e);
                      const errorMessage = e.message
                        ? `${t('Failed to pause Virtual Machine')}: ${e.message}`
                        : t('Failed to pause Virtual Machine');
                      enqueueSnackbar(errorMessage, { variant: 'error' });
                    });
                }}
              />
            ),
          });
        }

        if (isRunning) {
          actionsList.push({
            id: 'migrate',
            action: (
              <ActionButton
                description={t('Live Migrate')}
                icon="mdi:swap-horizontal"
                onClick={() => {
                  item
                    .migrate()
                    .then(() => {
                      enqueueSnackbar(t('Live migration initiated'), { variant: 'success' });
                    })
                    .catch(e => {
                      console.error('Migration failed', e);
                      enqueueSnackbar(t('Failed to initiate live migration'), { variant: 'error' });
                    });
                }}
              />
            ),
          });
        }

        if (isPaused) {
          actionsList.push({
            id: 'unpause',
            action: (
              <ActionButton
                description={t('Unpause')}
                icon="mdi:play-pause"
                onClick={() => {
                  item
                    .unpause()
                    .then(() =>
                      enqueueSnackbar(t('Virtual Machine unpaused'), { variant: 'success' })
                    )
                    .catch(e => {
                      console.error('Unpause failed', e);
                      enqueueSnackbar(t('Failed to unpause Virtual Machine'), { variant: 'error' });
                    });
                }}
              />
            ),
          });
        }

        if (isRunning || isPaused) {
          actionsList.push({
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
          });
        }

        return actionsList;
      }}
    />
  );
}

function getStatusColor(status: string) {
  if (status === 'Running') return 'success';
  if (status === 'Failed') return 'error';
  if (['Migrating', 'Starting', 'Stopping'].includes(status)) return 'warning';
  return 'default';
}

async function getPodInfo(
  name: string,
  namespace: string
): Promise<{ podName: string; nodeName: string }> {
  const request = ApiProxy.request;
  const queryParams = new URLSearchParams();
  queryParams.append('labelSelector', `vm.kubevirt.io/name=${name}`);
  try {
    const response = await request(
      `/api/v1/namespaces/${namespace}/pods?${queryParams.toString()}`,
      {
        method: 'GET',
      }
    );
    const pod = response?.items[0];
    if (pod) {
      return {
        podName: pod.metadata.name,
        nodeName: pod.spec.nodeName || 'Unknown',
      };
    }
    return { podName: 'Unknown', nodeName: 'Unknown' };
  } catch (error) {
    return { podName: 'Unknown', nodeName: 'Unknown' };
  }
}
