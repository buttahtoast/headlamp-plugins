export type ShellNamespace = {
  name: string;
  phase: string;
};

export type ShellNamespaceSection = 'Favorites' | 'Recent' | 'Namespaces';

export type ShellNamespaceRow = ShellNamespace & {
  section: ShellNamespaceSection;
};

const NAME_LIMIT = 253;

export const SHELL_RECENT_KEY = 'buttah-shell.recentNamespaces';
export const SHELL_FAVORITE_KEY = 'buttah-shell.favoriteNamespaces';

export function rememberShellNamespace(name: string): void {
  try {
    const next = rememberShellName(localStorage.getItem(SHELL_RECENT_KEY), name);
    localStorage.setItem(SHELL_RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode can reject the write. The shell still opens.
  }
}

export function readShellNames(stored: string | null): string[] {
  if (!stored) {
    return [];
  }
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const names: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string' || item.length === 0 || item.length > NAME_LIMIT) {
        continue;
      }
      if (!names.includes(item)) {
        names.push(item);
      }
      if (names.length === 8) {
        break;
      }
    }
    return names;
  } catch {
    return [];
  }
}

export function rememberShellName(stored: string | null, name: string): string[] {
  return [name, ...readShellNames(stored).filter(item => item !== name)].slice(0, 5);
}

export function toggleShellName(stored: string | null, name: string): string[] {
  const current = readShellNames(stored);
  if (current.includes(name)) {
    return current.filter(item => item !== name);
  }
  return [name, ...current].slice(0, 8);
}

/** Favorites, then recent, then the rest. A namespace is listed once. */
export function shellNamespaceRows(input: {
  namespaces: ShellNamespace[];
  query: string;
  recent: string[];
  favorites: string[];
}): ShellNamespaceRow[] {
  const query = input.query.trim().toLowerCase();
  const matches = input.namespaces.filter(item => item.name.toLowerCase().includes(query));
  const byName = new Map(matches.map(item => [item.name, item]));
  const rows: ShellNamespaceRow[] = [];
  const used = new Set<string>();
  const push = (section: ShellNamespaceSection, name: string) => {
    const item = byName.get(name);
    if (!item || used.has(name)) {
      return;
    }
    used.add(name);
    rows.push({ ...item, section });
  };
  for (const name of input.favorites) {
    push('Favorites', name);
  }
  for (const name of input.recent) {
    push('Recent', name);
  }
  for (const item of matches) {
    if (!used.has(item.name)) {
      rows.push({ ...item, section: 'Namespaces' });
    }
  }
  return rows;
}
