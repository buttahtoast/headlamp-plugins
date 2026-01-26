import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';

const { NamespacesAutocomplete } = CommonComponents;

// Re-export NamespacesAutocomplete for use in list pages
export { NamespacesAutocomplete };

// Hook to read namespace filter from URL (set by NamespacesAutocomplete)
export function useNamespaceFilter(): string[] {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const namespaceParam = searchParams.get('namespace');
  if (!namespaceParam) return [];
  return namespaceParam.split(' ').filter(ns => ns.length > 0);
}

export interface ColumnDef<T extends string = string> {
  id: T;
  label: string;
  minWidth?: number;
  sortable?: boolean;
  filterable?: boolean;
}

export interface ListToolbarProps {
  // Search
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Filters
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;

  // Column visibility
  columns: ColumnDef[];
  visibleColumns: Set<string>;
  onToggleColumn: (columnId: string) => void;

  // Selection
  selectedCount?: number;
  onDeleteSelected?: () => void;

  // Left content (e.g., Create button)
  leftContent?: React.ReactNode;
}

export function ListToolbar({
  showSearch,
  setShowSearch,
  searchQuery,
  setSearchQuery,
  showFilters,
  setShowFilters,
  columns,
  visibleColumns,
  onToggleColumn,
  selectedCount = 0,
  onDeleteSelected,
  leftContent,
}: ListToolbarProps) {
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);

  return (
    <>
      <Toolbar
        variant="dense"
        disableGutters
        sx={{ mb: 1, gap: 1, minHeight: 'auto', flexWrap: 'wrap' }}
      >
        {leftContent}
        <Box sx={{ flexGrow: 1 }} />

        {showSearch && (
          <TextField
            size="small"
            placeholder="Search all columns..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ minWidth: 250 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon icon="mdi:magnify" width={18} />
                </InputAdornment>
              ),
              endAdornment: searchQuery && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearchQuery('')}>
                    <Icon icon="mdi:close" width={16} />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        )}

        {selectedCount > 0 && onDeleteSelected && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: 'action.selected',
              borderRadius: 1,
              px: 1.5,
              py: 0.5,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {selectedCount} selected
            </Typography>
            <Button
              variant="contained"
              color="error"
              size="small"
              startIcon={<Icon icon="mdi:delete" />}
              onClick={onDeleteSelected}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Delete Selected
            </Button>
          </Box>
        )}

        <Tooltip title={showSearch ? 'Hide search' : 'Show search'}>
          <IconButton
            onClick={() => setShowSearch(!showSearch)}
            color={showSearch ? 'primary' : 'default'}
          >
            <Icon icon="mdi:magnify" width={24} />
          </IconButton>
        </Tooltip>
        <Tooltip title={showFilters ? 'Hide filters' : 'Show filters'}>
          <IconButton
            onClick={() => setShowFilters(!showFilters)}
            color={showFilters ? 'primary' : 'default'}
          >
            <Icon icon="mdi:filter-variant" width={24} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Manage columns">
          <IconButton onClick={(e) => setColumnMenuAnchor(e.currentTarget)}>
            <Icon icon="mdi:view-column" width={24} />
          </IconButton>
        </Tooltip>
      </Toolbar>

      {/* Column Menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={() => setColumnMenuAnchor(null)}
      >
        <MenuItem disabled>
          <Typography variant="subtitle2">Show/Hide Columns</Typography>
        </MenuItem>
        {columns.map((col) => (
          <MenuItem key={col.id} onClick={() => onToggleColumn(col.id)}>
            <Checkbox checked={visibleColumns.has(col.id)} size="small" />
            <Typography variant="body2">{col.label}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export interface ListPageLayoutProps {
  title: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function ListPageLayout({ title, headerAction, children }: ListPageLayoutProps) {
  return (
    <SectionBox title={title}>
      {headerAction && (
        <Box sx={{ mb: 2 }}>
          {headerAction}
        </Box>
      )}
      {children}
    </SectionBox>
  );
}
