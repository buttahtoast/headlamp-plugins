import { Button, Divider, List, ListItem, ListItemText, Menu } from '@mui/material';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useEffect, useState } from 'react';
import { Tenants } from '../resources/tenants';
import { NamespaceSetter } from '../utils/namespace'; // Ensure correct import path

export function TenantBox() {
  // All hooks at the top, unconditionally
  const [tenants, error] = Tenants.useList();
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [openDialog, setOpenDialog] = useState(false);
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));

  console.log('Tenants.useList:', { tenants, error });

  // Handle side effects
  useEffect(() => {
    const saved = localStorage.getItem('selectedTenant');
    let parsedTenant = null;
    if (saved) {
      try {
        parsedTenant = JSON.parse(saved);
        // Validate that parsedTenant has the expected structure
        if (
          parsedTenant &&
          parsedTenant.metadata &&
          typeof parsedTenant.metadata.name === 'string'
        ) {
          setSelectedTenant(parsedTenant);
        } else {
          console.warn('Invalid tenant data in localStorage:', parsedTenant);
          localStorage.removeItem('selectedTenant'); // Clear invalid data
        }
      } catch (e) {
        console.error('Error parsing localStorage tenant:', e);
        localStorage.removeItem('selectedTenant'); // Clear corrupted data
      }
    }
    // Fallback to first tenant if none selected or invalid
    if (!parsedTenant && tenants && tenants.length > 0) {
      handleSelect(tenants[0]);
    }
  }, [tenants]);

  // Early returns after all hooks
  if (error) return <div>Error loading tenants: {error.message || error.toString()}</div>;
  if (!tenants) return <div>Loading...</div>;
  if (tenants.length === 0) return <div>No tenants available</div>;

  // Handlers
  const handleClick = event => {
    console.log('Button clicked', { isSmall, event });
    if (isSmall) {
      setOpenDialog(true);
    } else {
      setAnchorEl(event.currentTargetmillar);
      setAnchorEl(event.currentTarget);
    }
  };

  const handleSelect = tenant => {
    if (tenant && tenant.metadata && tenant.metadata.name) {
      setSelectedTenant(tenant);
      localStorage.setItem('selectedTenant', JSON.stringify(tenant));
      handleClose();
    } else {
      console.warn('Attempted to select invalid tenant:', tenant);
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
    setOpenDialog(false);
  };

  // Defensive check for currentName
  const currentName =
    selectedTenant?.metadata?.name && typeof selectedTenant.metadata.name === 'string'
      ? selectedTenant.metadata.name
      : 'Select Tenant';

  const content = (
    <List>
      {tenants.map(tenant => (
        <ListItem
          button
          key={tenant.metadata?.name || `tenant-${Math.random()}`} // Fallback key if name is missing
          onClick={() => handleSelect(tenant)}
          selected={
            selectedTenant &&
            selectedTenant.metadata?.name &&
            selectedTenant.metadata.name === tenant.metadata?.name
          }
        >
          <ListItemText primary={tenant.metadata?.name || 'Unnamed Tenant'} />
        </ListItem>
      ))}
      <Divider />
    </List>
  );

  return (
    <>
      <Button variant="outlined" color="inherit" onClick={handleClick}>
        {currentName}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        {content}
      </Menu>
      <Dialog open={openDialog} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>Choose Tenant</DialogTitle>
        {content}
      </Dialog>
      {/* Render NamespaceSetter as a component */}
      {selectedTenant && selectedTenant.status?.namespaces && (
        <NamespaceSetter namespaces={selectedTenant.status.namespaces} />
      )}
    </>
  );
}
