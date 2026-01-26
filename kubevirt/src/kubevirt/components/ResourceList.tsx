import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Toolbar,
  Typography,
} from '@mui/material';
import React, { ReactNode, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

const { NamespacesAutocomplete } = CommonComponents;

// Re-export for convenience
export { NamespacesAutocomplete };

// Hook to read namespace filter from URL (set by NamespacesAutocomplete)
export function useNamespaceFilter(): string[] {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const namespaceParam = searchParams.get('namespace');
  if (!namespaceParam) return [];
  return namespaceParam.split(' ').filter(ns => ns.length > 0);
}

/**
 * Column definition compatible with Headlamp's Table component
 */
export interface ResourceListColumn<T> {
  /** Unique column ID */
  id: string;
  /** Column header label */
  header: string;
  /** Get the value for sorting/filtering */
  accessorFn?: (row: T) => any;
  /** Custom cell renderer */
  Cell?: (props: { row: { original: T } }) => ReactNode;
  /** Column width in grid template format */
  gridTemplate?: string | number;
  /** Enable/disable sorting for this column */
  enableSorting?: boolean;
  /** Enable/disable filtering for this column */
  enableColumnFilter?: boolean;
  /** Filter variant: 'text', 'select', 'multi-select', etc. */
  filterVariant?: 'text' | 'select' | 'multi-select' | 'range' | 'date' | 'date-range';
  /** Options for select filter */
  filterSelectOptions?: string[] | { label: string; value: string }[];
  /** Show column by default */
  show?: boolean;
}

export interface ResourceListProps<T extends Record<string, any>> {
  /** Page title */
  title: string;
  /** Data array */
  data: T[] | null;
  /** Column definitions */
  columns: ResourceListColumn<T>[];
  /** Loading state */
  loading?: boolean;
  /** Error message */
  errorMessage?: string;
  /** Show namespace filter in header */
  showNamespaceFilter?: boolean;
  /** Filter function for namespace filtering */
  namespaceGetter?: (item: T) => string;
  /** Left content in toolbar (e.g., Create button) */
  toolbarAction?: ReactNode;
  /** Enable row selection */
  enableRowSelection?: boolean;
  /** Callback when selection changes */
  onSelectionChange?: (selectedItems: T[]) => void;
  /** Custom row actions */
  renderRowActions?: (row: T) => ReactNode;
  /** Unique ID for this table (for URL state persistence) */
  id?: string;
  /** Reflect table state in URL */
  reflectInURL?: boolean | string;
  /** Default sorting */
  defaultSortingColumn?: { id: string; desc: boolean };
  /** Empty state message */
  emptyMessage?: string;
  /** Row selection toolbar (shows when rows are selected) */
  renderRowSelectionToolbar?: (props: { selectedRows: T[]; clearSelection: () => void }) => ReactNode;
}

/**
 * A reusable list component that wraps Headlamp's Table with additional features
 * like namespace filtering, custom toolbar, and consistent styling.
 */
export function ResourceList<T extends Record<string, any>>({
  title,
  data,
  columns,
  loading = false,
  errorMessage,
  showNamespaceFilter = false,
  namespaceGetter,
  toolbarAction,
  enableRowSelection = false,
  onSelectionChange,
  renderRowActions,
  id,
  reflectInURL = true,
  defaultSortingColumn,
  emptyMessage = 'No items found',
  renderRowSelectionToolbar,
}: ResourceListProps<T>) {
  const selectedNamespaces = useNamespaceFilter();

  // Filter data by namespace if needed
  const filteredData = useMemo(() => {
    if (!data) return null;
    if (!showNamespaceFilter || selectedNamespaces.length === 0 || !namespaceGetter) {
      return data;
    }
    return data.filter(item => selectedNamespaces.includes(namespaceGetter(item)));
  }, [data, selectedNamespaces, showNamespaceFilter, namespaceGetter]);

  // Convert our column format to MRT format
  const tableColumns = useMemo(() => {
    return columns.map(col => ({
      id: col.id,
      header: col.header,
      accessorFn: col.accessorFn,
      Cell: col.Cell ? ({ row }: any) => col.Cell!({ row }) : undefined,
      gridTemplate: col.gridTemplate,
      enableSorting: col.enableSorting !== false,
      enableColumnFilter: col.enableColumnFilter !== false,
      filterVariant: col.filterVariant,
      filterSelectOptions: col.filterSelectOptions,
      // MRT uses 'show' as part of columnVisibility state, not column definition
    }));
  }, [columns]);

  // Initial column visibility based on 'show' property
  const initialColumnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {};
    columns.forEach(col => {
      if (col.show === false) {
        visibility[col.id] = false;
      }
    });
    return visibility;
  }, [columns]);

  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});

  // Get selected rows
  const selectedRows = useMemo(() => {
    if (!filteredData) return [];
    return filteredData.filter((_, index) => rowSelection[index]);
  }, [filteredData, rowSelection]);

  // Clear selection
  const clearSelection = () => setRowSelection({});

  // Notify parent of selection changes
  React.useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(selectedRows);
    }
  }, [selectedRows, onSelectionChange]);

  return (
    <SectionBox
      title={title}
      headerProps={{
        actions: showNamespaceFilter ? [<NamespacesAutocomplete key="ns-filter" />] : [],
      }}
    >
      {/* Toolbar with action and selection info */}
      {(toolbarAction || (enableRowSelection && selectedRows.length > 0)) && (
        <Toolbar
          variant="dense"
          disableGutters
          sx={{ mb: 1, gap: 1, minHeight: 'auto' }}
        >
          {toolbarAction}
          <Box sx={{ flexGrow: 1 }} />
          {enableRowSelection && selectedRows.length > 0 && renderRowSelectionToolbar && (
            renderRowSelectionToolbar({ selectedRows, clearSelection })
          )}
        </Toolbar>
      )}

      {/* Error state */}
      {errorMessage && (
        <Box sx={{ p: 2, textAlign: 'center' }}>
          <Typography color="error">{errorMessage}</Typography>
        </Box>
      )}

      {/* Table */}
      {!errorMessage && (
        <Table
          columns={tableColumns as any}
          data={filteredData || []}
          loading={loading}
          emptyMessage={emptyMessage}
          reflectInURL={reflectInURL ? (id || true) : false}
          enableRowSelection={enableRowSelection}
          onRowSelectionChange={setRowSelection as any}
          state={{ rowSelection }}
          initialState={{
            columnVisibility: initialColumnVisibility,
            sorting: defaultSortingColumn ? [defaultSortingColumn] : [],
          }}
          enableColumnFilters
          enableGlobalFilter
          enableHiding
          enablePagination
          enableSorting
          enableDensityToggle={false}
          enableFullScreenToggle={false}
          renderRowActions={renderRowActions ? ({ row }: any) => renderRowActions(row.original) : undefined}
          muiTableContainerProps={{
            sx: { maxHeight: 'calc(100vh - 300px)' },
          }}
        />
      )}
    </SectionBox>
  );
}

/**
 * Convenience component for a selection toolbar with delete action
 */
export interface SelectionToolbarProps<T> {
  selectedRows: T[];
  clearSelection: () => void;
  onDelete?: (items: T[]) => void;
  deleteLabel?: string;
}

export function SelectionToolbar<T>({
  selectedRows,
  clearSelection,
  onDelete,
  deleteLabel = 'Delete Selected',
}: SelectionToolbarProps<T>) {
  if (selectedRows.length === 0) return null;

  return (
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
        {selectedRows.length} selected
      </Typography>
      {onDelete && (
        <Button
          variant="contained"
          color="error"
          size="small"
          onClick={() => {
            onDelete(selectedRows);
            clearSelection();
          }}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {deleteLabel}
        </Button>
      )}
    </Box>
  );
}

export default ResourceList;
