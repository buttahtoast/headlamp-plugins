import { Icon } from '@iconify/react';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import { useId, useState } from 'react';

export function ResourceActions({
  label,
  actions,
}: {
  label: string;
  actions: { label: string; icon: string; disabled?: boolean; run: () => void }[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  return (
    <>
      <ActionButton
        description={label}
        icon="mdi:dots-vertical"
        onClick={event => setAnchor(event.currentTarget)}
        iconButtonProps={{
          id: `${id}-button`,
          'aria-haspopup': 'menu',
          'aria-controls': anchor ? `${id}-menu` : undefined,
          'aria-expanded': !!anchor,
        }}
      />
      <Menu
        id={`${id}-menu`}
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        MenuListProps={{ 'aria-labelledby': `${id}-button` }}
      >
        {actions.map(action => (
          <MenuItem
            key={action.label}
            disabled={action.disabled}
            onClick={() => {
              setAnchor(null);
              action.run();
            }}
          >
            <ListItemIcon>
              <Icon icon={action.icon} width={20} />
            </ListItemIcon>
            <ListItemText>{action.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
