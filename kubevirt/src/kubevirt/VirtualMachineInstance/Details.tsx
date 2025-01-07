import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
// import {
//   EventStatus,
//   HeadlampEventType,
//   useEventCallback,
// } from '@kinvolk/headlamp-plugin/lib/redux/headlampEventSlice';
//import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import Terminal from '../Terminal/Terminal';
import VirtualMachineInstance from './VirtualMachineInstance';

export interface VirtualMachineDetailsProps {
  showLogsDefault?: boolean;
  name?: string;
  namespace?: string;
}
export default function VirtualMachineInstanceDetails(props: VirtualMachineDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const [showTerminal, setShowTerminal] = useState(false);
  console.log(showTerminal);
  //const dispatchHeadlampEvent = useEventCallback();
  //const { enqueueSnackbar } = useSnackbar();
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
            id: 'console',
            action: (
              <Resource.AuthVisible item={item} authVerb="get" subresource="exec">
                <ActionButton
                  description={t('Terminal / Exec')}
                  aria-label={t('terminal')}
                  icon="mdi:console"
                  onClick={() => {
                    setShowTerminal(true);
                    // dispatchHeadlampEvent({
                    //   type: HeadlampEventType.TERMINAL,
                    //   data: {
                    //     resource: item,
                    //     status: EventStatus.CLOSED,
                    //   },
                    // });
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
