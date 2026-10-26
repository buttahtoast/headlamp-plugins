import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardContent, Chip, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { Cell, Pie, PieChart } from 'recharts';
import { visibleStatChips, visibleStatSegments } from './statCardVisibility';

export interface StatSegment {
  name: string;
  value: number;
  color: string;
}

export interface StatChip {
  label: string;
  color?: 'default' | 'success' | 'warning' | 'error' | 'primary' | 'info';
  /** Explicit numeric value; zero-value chips are hidden. */
  value?: number;
}

export interface StatCardProps {
  /** Small uppercase caption shown at the top of the card. */
  label: string;
  /** The large headline value. */
  total: ReactNode;
  /** Donut-pie segments. When their sum is 0 the empty label is shown instead. */
  segments?: StatSegment[];
  /** Summary chips rendered under the pie. */
  chips?: StatChip[];
  /** Optional footer node (e.g. helper caption). */
  footer?: ReactNode;
  /** Pixel size of the pie. Defaults to 56. */
  pieSize?: number;
  /** Stretch the card to fill its grid cell height. */
  fullHeight?: boolean;
  /** Text shown when there is nothing to chart. Defaults to "None". */
  emptyLabel?: string;
  /** Optional Headlamp route that makes the entire card navigable. */
  routeName?: string;
  /** Route parameters passed to Headlamp's cluster-aware Link. */
  routeParams?: Record<string, string>;
  /** Optional query parameters passed to Headlamp's cluster-aware Link. */
  routeSearch?: Record<string, string>;
}

/**
 * Reusable summary tile: caption + headline number + readiness donut + chips.
 * Replaces the stat-card/pie blocks that were copy-pasted across the overview,
 * tenant list, quota lists and tenant-resource stats.
 */
export function StatCard({
  label,
  total,
  segments = [],
  chips = [],
  footer,
  pieSize = 56,
  fullHeight = true,
  emptyLabel = 'None',
  routeName,
  routeParams,
  routeSearch,
}: StatCardProps) {
  const visibleSegments = visibleStatSegments(segments);
  const visibleChips = visibleStatChips(chips);
  const sum = visibleSegments.reduce((acc, s) => acc + s.value, 0);
  const innerRadius = Math.round(pieSize * 0.3);
  const outerRadius = Math.round(pieSize * 0.46);

  const card = (
    <Card
      variant="outlined"
      sx={{
        width: '100%',
        ...(fullHeight ? { height: '100%' } : {}),
      }}
    >
      <CardContent
        sx={{
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 2.5,
          textAlign: 'center',
          '&:last-child': { pb: 2.5 },
        }}
      >
        <Typography
          color="text.secondary"
          variant="caption"
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            justifyContent: 'center',
            lineHeight: 1.3,
            minHeight: 32,
            width: '100%',
          }}
        >
          {label}
        </Typography>
        <Typography variant="h4" sx={{ lineHeight: 1.2 }}>
          {total}
        </Typography>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mt: 1,
            minHeight: Math.max(56, pieSize),
          }}
        >
          {sum > 0 ? (
            <PieChart width={pieSize} height={pieSize}>
              <Pie
                data={visibleSegments}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
              >
                {visibleSegments.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {emptyLabel}
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            alignContent: 'flex-start',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            justifyContent: 'center',
            minHeight: 48,
            mt: 0.5,
            width: '100%',
          }}
        >
          {visibleChips.map((chip, index) => (
            <Chip
              key={`${chip.label}-${index}`}
              size="small"
              label={chip.label}
              color={chip.color}
            />
          ))}
        </Box>

        <Box
          sx={{
            alignItems: 'flex-end',
            display: 'flex',
            justifyContent: 'center',
            minHeight: 24,
            mt: 'auto',
            pt: 0.5,
            width: '100%',
          }}
        >
          {footer}
        </Box>
      </CardContent>
    </Card>
  );

  if (!routeName) return card;

  return (
    <Link
      routeName={routeName}
      params={routeParams}
      search={routeSearch}
      aria-label={`Open ${label.toLowerCase()}`}
      sx={(theme: Theme) => ({
        color: 'inherit',
        display: 'block',
        height: '100%',
        textDecoration: 'none',
        '& .MuiCard-root': {
          transition: theme.transitions.create(['border-color', 'box-shadow', 'transform'], {
            duration: theme.transitions.duration.shortest,
          }),
        },
        '&:hover': { textDecoration: 'none' },
        '&:hover .MuiCard-root': {
          borderColor: 'primary.main',
          boxShadow: 3,
          transform: 'translateY(-2px)',
        },
        '&:focus-visible': { outline: 'none' },
        '&:focus-visible .MuiCard-root': {
          outline: `3px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {card}
    </Link>
  );
}

export default StatCard;
