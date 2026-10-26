import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box } from '@mui/material';
import { jsonData, ResourceData, STATE_COLORS, STATE_LABELS, summarize } from './health';
import { StatCard, StatChip } from './StatCard';
import { SummaryCardGrid } from './SummaryCardGrid';

export function ListStats({
  resources,
  label,
  loading = false,
  error,
  inventory = false,
}: {
  resources: ResourceData[] | null;
  label: string;
  loading?: boolean;
  error?: { message?: string };
  inventory?: boolean;
}) {
  const filter = useFilterFunc();
  const { t } = useTranslation();
  const items = (resources || []).filter(item => filter(item as any));
  const stats = summarize(items);
  const pending = loading || resources === null;
  const segments = Object.entries(STATE_COLORS).map(([key, color]) => ({
    name: t(STATE_LABELS[key]),
    value: stats[key],
    color,
  }));
  const chips: StatChip[] = [
    { label: `${stats.ready} ${t('Ready')}`, color: 'success', value: stats.ready },
    { label: `${stats.failed} ${t('Failed')}`, color: 'error', value: stats.failed },
    { label: `${stats.reconciling} ${t('Reconciling')}`, color: 'info', value: stats.reconciling },
    { label: `${stats.suspended} ${t('Suspended')}`, color: 'warning', value: stats.suspended },
    { label: `${stats.configured} ${t('Configured')}`, value: stats.configured },
    { label: `${stats.unknown} ${t('Unknown')}`, value: stats.unknown },
  ];
  const groupKinds = new Set(items.map(x => jsonData(x).kind)).size;
  return (
    <>
      {error && (
        <Box sx={{ px: 2, pt: 2 }}>
          <Alert severity="warning">
            {error.message || t('Some resources could not be loaded.')}
          </Alert>
        </Box>
      )}
      <SummaryCardGrid columns={3} inset>
        <StatCard
          label={label.toUpperCase()}
          total={pending ? '…' : error && !stats.total ? '—' : stats.total}
          segments={pending ? [] : segments}
          chips={pending ? [] : chips}
          emptyLabel={pending ? t('Loading') : error && !stats.total ? t('Unavailable') : t('None')}
        />
        <StatCard
          label={t('NAMESPACES')}
          total={pending ? '…' : stats.namespaces}
          footer={t('Namespaces represented in this view')}
        />
        <StatCard
          label={inventory ? t('INVENTORY OBJECTS') : t('RESOURCE TYPES')}
          total={pending ? '…' : inventory ? stats.inventory : groupKinds}
          footer={
            inventory
              ? t('Recorded by Flux at the last reconciliation')
              : t('Kinds represented in this view')
          }
        />
      </SummaryCardGrid>
    </>
  );
}
