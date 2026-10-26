import {
  Alert,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useState } from 'react';
import { buildSSAFieldLines, managerKey, mergeSSAFields, ownershipFields } from './model';

export interface ManagerDiffProps {
  object: Record<string, any>;
  preferredManagers?: string[];
  preferredLabel?: string;
  allowSubresources?: boolean;
}

export function ManagerDiff({
  object,
  preferredManagers = [],
  preferredLabel = 'Preferred controller managers',
  allowSubresources = true,
}: ManagerDiffProps) {
  const [includeSubresources, setIncludeSubresources] = useState(false);
  const [selection, setSelection] = useState<string>();
  const fields = ownershipFields(object, includeSubresources);
  const preferred = fields.filter(
    field => preferredManagers.includes(field.manager) && !field.subresource
  );
  const preferredApplies = preferred.filter(field => field.operation === 'Apply');
  const applies = fields.filter(field => field.operation === 'Apply');
  const fallback = preferredApplies.length
    ? 'preferred'
    : preferred.length
    ? managerKey(preferred[0])
    : applies.length
    ? 'apply'
    : 'all';
  const choices = [...new Map(fields.map(field => [managerKey(field), field])).values()];
  const selected = [
    'all',
    'apply',
    ...(preferredManagers.length ? ['preferred'] : []),
    ...choices.map(managerKey),
  ].includes(selection || '')
    ? selection
    : fallback;
  const managed =
    selected === 'all'
      ? fields
      : selected === 'apply'
      ? applies
      : selected === 'preferred'
      ? preferredApplies
      : fields.filter(field => managerKey(field) === selected);
  const combined = mergeSSAFields(...managed.map(field => field.fieldsV1));
  const lines = combined ? buildSSAFieldLines(object, combined) : [];
  const update = managed.some(field => field.operation === 'Update');
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }}>
        <TextField
          select
          size="small"
          label="Field manager"
          value={selected}
          onChange={event => setSelection(event.target.value)}
          sx={{ minWidth: 280 }}
        >
          {preferredManagers.length > 0 && <MenuItem value="preferred">{preferredLabel}</MenuItem>}
          <MenuItem value="apply">All SSA Apply managers</MenuItem>
          <MenuItem value="all">All field managers</MenuItem>
          {choices.map(field => (
            <MenuItem key={managerKey(field)} value={managerKey(field)}>
              {field.manager} · {field.operation}
              {field.subresource ? ` · ${field.subresource}` : ''}
            </MenuItem>
          ))}
        </TextField>
        {allowSubresources && (
          <FormControlLabel
            control={
              <Checkbox
                checked={includeSubresources}
                onChange={event => setIncludeSubresources(event.target.checked)}
              />
            }
            label="Include status and subresources"
          />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Highlighted lines are live fields owned by the selected manager. The surrounding lines
        provide live-object context. This ownership view uses Kubernetes managedFields; Git drift
        requires a rendered desired manifest.
      </Typography>
      {!managed.length && (
        <Alert severity="info">
          No field ownership is recorded for this selection. Choose another manager or include
          status and subresources. Managed fields may be unavailable on older resources or
          restricted API responses.
        </Alert>
      )}
      {update && (
        <Alert severity="info">
          This selection includes Update operations. Highlighted fields show recorded manager
          ownership; Update records describe ordinary API updates rather than SSA Apply.
        </Alert>
      )}
      {managed.length > 0 && (
        <>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Chip
              size="small"
              color="success"
              label={update ? 'Manager-owned fields' : 'SSA-owned fields'}
            />
            <Typography variant="caption" color="text.secondary">
              {lines.filter(line => line.managed).length} highlighted lines
            </Typography>
          </Stack>
          <Stack direction="row" gap={1} flexWrap="wrap">
            {managed.map((field, index) => (
              <Chip
                key={`${managerKey(field)}/${field.apiVersion}/${index}`}
                size="small"
                variant="outlined"
                color="success"
                label={`${field.manager} · ${field.operation}${
                  field.subresource ? ` · ${field.subresource}` : ''
                }`}
                title={[field.apiVersion, field.time].filter(Boolean).join(' · ')}
              />
            ))}
          </Stack>
        </>
      )}
      {lines.length > 0 && (
        <Box
          component="pre"
          aria-label="SSA field ownership diff"
          sx={{
            m: 0,
            py: 1,
            maxHeight: '60vh',
            overflow: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.65,
          }}
        >
          {lines.map((line, index) => (
            <Box
              component="span"
              key={index}
              data-managed={line.managed || undefined}
              sx={theme => ({
                display: 'grid',
                gridTemplateColumns: '3.5rem minmax(max-content, 1fr)',
                px: 1.25,
                borderLeft: '3px solid',
                borderLeftColor: line.managed ? 'success.main' : 'transparent',
                bgcolor: line.managed ? alpha(theme.palette.success.main, 0.12) : 'transparent',
                color: line.managed
                  ? theme.palette.mode === 'dark'
                    ? 'success.light'
                    : 'success.dark'
                  : 'text.primary',
                fontWeight: line.managed ? 600 : 400,
              })}
            >
              <Box component="span" sx={{ userSelect: 'none', color: 'text.disabled' }}>
                {index + 1}
              </Box>
              <Box component="span">{line.text}</Box>
            </Box>
          ))}
        </Box>
      )}
    </Stack>
  );
}
