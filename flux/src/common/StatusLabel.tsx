import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { StatusLabel as HLStatusLabel } from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeCRD } from '@kinvolk/headlamp-plugin/lib/k8s/crd';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/KubeObject';
import { Tooltip, Typography } from '@mui/material';
import { conditionMessage, fluxState, STATE_LABELS } from './health';

export function getStatusText(item: KubeObject | KubeCRD): string {
  return STATE_LABELS[fluxState(item)];
}

export default function StatusLabel({ item }: { item: KubeObject }) {
  const { t } = useTranslation();
  const state = fluxState(item);
  const tone =
    state === 'ready'
      ? 'success'
      : state === 'failed'
      ? 'error'
      : state === 'suspended' || state === 'reconciling'
      ? 'warning'
      : '';
  return (
    <HLStatusLabel status={tone}>
      <Tooltip title={conditionMessage(item)}>
        <Typography component="span">{t(getStatusText(item))}</Typography>
      </Tooltip>
    </HLStatusLabel>
  );
}
