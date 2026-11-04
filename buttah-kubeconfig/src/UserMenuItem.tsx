import MenuItem from '@mui/material/MenuItem';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const SLOT_ID = 'buttah-user-menu-slot';

function menuList(): HTMLElement | null {
  const menu = document.getElementById('primary-user-menu');
  if (!menu || menu.getAttribute('aria-hidden') === 'true') {
    return null;
  }
  const list = menu.querySelector('.MuiMenu-list');
  return list instanceof HTMLElement ? list : null;
}

function ensureSlot(list: HTMLElement): HTMLElement {
  const existing = document.getElementById(SLOT_ID);
  if (existing instanceof HTMLElement && existing.parentElement === list) {
    return existing;
  }
  const slot = document.createElement('li');
  slot.id = SLOT_ID;
  list.insertBefore(slot, list.firstChild);
  return slot;
}

function closeUserMenu(): void {
  const menu = document.getElementById('primary-user-menu');
  const backdrop = menu?.querySelector('.MuiBackdrop-root');
  if (backdrop instanceof HTMLElement) {
    backdrop.click();
    return;
  }
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
  );
}

export function UserMenuItem({
  id,
  label,
  disabled,
  onSelect,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = () => {
      const list = menuList();
      setSlot(list ? ensureSlot(list) : null);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, []);

  if (!slot) {
    return null;
  }
  return createPortal(
    <MenuItem
      id={id}
      disabled={disabled}
      onClick={() => {
        closeUserMenu();
        onSelect();
      }}
    >
      {label}
    </MenuItem>,
    slot
  );
}
