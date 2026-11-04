import { useTheme } from '@mui/material/styles';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import {
  readShellNames,
  SHELL_FAVORITE_KEY,
  SHELL_RECENT_KEY,
  type ShellNamespace,
  type ShellNamespaceRow,
  shellNamespaceRows,
  toggleShellName,
} from './shellPlaces';

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.8 9.7 5.6l4.1.4-3.1 2.7.9 4L8 10.7 4.4 12.7l.9-4L2.2 6l4.1-.4L8 1.8Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function storedNames(key: string): string[] {
  try {
    return readShellNames(localStorage.getItem(key));
  } catch {
    return [];
  }
}

export function NamespacePalette({
  open,
  namespaces,
  namespace,
  reading,
  listError,
  startError,
  status,
  note,
  configNote,
  starting,
  accessReady,
  onNamespace,
  onClose,
  onStart,
}: {
  open: boolean;
  namespaces: ShellNamespace[];
  namespace: string | null;
  reading: boolean;
  listError: string | null;
  startError: string | null;
  status: string | null;
  note: string | null;
  configNote: string | null;
  starting: boolean;
  accessReady: boolean;
  onNamespace: (name: string) => void;
  onClose: () => void;
  onStart: (name: string) => void;
}) {
  const theme = useTheme();
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const mode = theme.palette.mode;
  const rows = shellNamespaceRows({ namespaces, query, recent, favorites });
  const rowKey = rows.map(row => row.name).join('\n');
  const selected = rows[cursor] ?? null;
  const canStart = Boolean(selected) && !starting && !listError && accessReady;

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setRecent(storedNames(SHELL_RECENT_KEY));
    setFavorites(storedNames(SHELL_FAVORITE_KEY));
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const names = rowKey ? rowKey.split('\n') : [];
    const index = names.indexOf(namespace || '');
    setCursor(index >= 0 ? index : 0);
  }, [namespace, rowKey]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  if (!open) {
    return null;
  }

  function move(next: number) {
    const row = rows[next];
    if (!row) {
      return;
    }
    setCursor(next);
    onNamespace(row.name);
  }

  function onQuery(value: string) {
    setQuery(value);
    const next = shellNamespaceRows({ namespaces, query: value, recent, favorites });
    setCursor(0);
    if (next[0]) {
      onNamespace(next[0].name);
    }
  }

  function toggleFavorite(name: string) {
    const next = toggleShellName(JSON.stringify(favorites), name);
    setFavorites(next);
    try {
      localStorage.setItem(SHELL_FAVORITE_KEY, JSON.stringify(next));
    } catch {
      // The star still updates for this visit.
    }
  }

  function onKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(Math.min(rows.length - 1, cursor + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(Math.max(0, cursor - 1));
    } else if (event.key === 'Enter' && selected && canStart) {
      event.preventDefault();
      onStart(selected.name);
    } else if (event.key === 'Escape' && !starting) {
      event.preventDefault();
      onClose();
    }
  }

  let section = '';
  const style = {
    '--buttah-palette-card': theme.palette.background.paper,
    '--buttah-palette-fg': theme.palette.text.primary,
    '--buttah-palette-muted': theme.palette.text.secondary,
    '--buttah-palette-line': theme.palette.divider,
    '--buttah-palette-accent': theme.palette.primary.main,
    '--buttah-palette-accent-ink': theme.palette.primary.contrastText,
    '--buttah-palette-hover': mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  } as CSSProperties;

  return (
    <div
      className="buttah-shell-palette"
      style={style}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !starting) {
          onClose();
        }
      }}
    >
      <div
        className="buttah-shell-palette-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="buttah-shell-palette-head">
          <h2 id={titleId}>Shell</h2>
          <p>Choose a namespace</p>
        </div>
        {note ? <p className="buttah-shell-note">{note}</p> : null}
        {configNote ? (
          <p className="buttah-shell-note" id="buttah-shell-cluster-config">
            {configNote}
          </p>
        ) : null}
        {status ? (
          <p className="buttah-shell-note" role="status">
            {status}
          </p>
        ) : null}
        <label className="buttah-shell-search">
          <span className="buttah-shell-sr">Find a namespace</span>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={selected ? `${listId}-${selected.name}` : undefined}
            placeholder="Find a namespace"
            value={query}
            disabled={starting}
            onChange={event => onQuery(event.target.value)}
            onKeyDown={onKey}
          />
          <kbd>Enter</kbd>
        </label>
        <div id={listId} className="buttah-shell-choices" role="listbox" aria-label="Namespaces">
          {reading && rows.length === 0 ? (
            <p className="buttah-shell-empty">Loading namespaces…</p>
          ) : null}
          {!reading && rows.length === 0 ? (
            <p className="buttah-shell-empty">
              {query ? 'No matching namespace.' : 'No namespaces.'}
            </p>
          ) : null}
          {rows.map((row, index) => {
            const heading = row.section === section ? null : row.section;
            section = row.section;
            return (
              <Choice
                key={row.name}
                listId={listId}
                row={row}
                heading={heading}
                selected={index === cursor}
                favorite={favorites.includes(row.name)}
                buttonRef={index === cursor ? activeRef : undefined}
                disabled={starting}
                onStart={onStart}
                onFavorite={toggleFavorite}
              />
            );
          })}
        </div>
        {listError ? <p className="buttah-shell-error">{listError}</p> : null}
        {startError ? <p className="buttah-shell-error">{startError}</p> : null}
        <div className="buttah-shell-palette-actions">
          <button type="button" onClick={onClose} disabled={starting}>
            Cancel
          </button>
          <button
            type="button"
            className="buttah-shell-primary"
            onClick={() => selected && onStart(selected.name)}
            disabled={!canStart}
          >
            {starting ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({
  listId,
  row,
  heading,
  selected,
  favorite,
  buttonRef,
  disabled,
  onStart,
  onFavorite,
}: {
  listId: string;
  row: ShellNamespaceRow;
  heading: string | null;
  selected: boolean;
  favorite: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  disabled: boolean;
  onStart: (name: string) => void;
  onFavorite: (name: string) => void;
}) {
  return (
    <>
      {heading ? <p className="buttah-shell-section">{heading}</p> : null}
      <div className="buttah-shell-choice-row">
        <button
          ref={buttonRef}
          id={`${listId}-${row.name}`}
          type="button"
          role="option"
          aria-selected={selected}
          className="buttah-shell-choice"
          data-selected={selected ? 'true' : 'false'}
          disabled={disabled}
          onClick={() => onStart(row.name)}
        >
          <span
            className="buttah-shell-phase"
            data-phase={(row.phase || 'unknown').toLowerCase()}
          />
          <span className="buttah-shell-choice-copy">
            <strong>{row.name}</strong>
            <span>{row.phase || 'Namespace'}</span>
          </span>
        </button>
        <button
          type="button"
          className="buttah-shell-star"
          aria-label={favorite ? `Unfavorite ${row.name}` : `Favorite ${row.name}`}
          aria-pressed={favorite}
          onClick={() => onFavorite(row.name)}
        >
          <Star filled={favorite} />
        </button>
      </div>
    </>
  );
}
