import { Box, Typography } from '@mui/material';
import { ReactNode } from 'react';

export function SummaryCardGrid({
  children,
  columns = 3,
  inset = false,
  title,
}: {
  children: ReactNode;
  columns?: number;
  inset?: boolean;
  title?: string;
}) {
  return (
    <Box sx={{ mb: 3, px: inset ? { xs: 0, sm: 2 } : 0, pt: inset ? 2 : 0, minWidth: 0 }}>
      {title && (
        <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
          {title}
        </Typography>
      )}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridAutoRows: '1fr',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: `repeat(${Math.min(columns, 2)}, minmax(0, 1fr))`,
            lg: `repeat(${columns}, minmax(0, 1fr))`,
          },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
