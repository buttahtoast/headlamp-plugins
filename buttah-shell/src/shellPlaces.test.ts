import { describe, expect, it } from 'vitest';
import {
  readShellNames,
  rememberShellName,
  shellNamespaceRows,
  toggleShellName,
} from './shellPlaces';

const namespaces = [
  { name: 'default', phase: 'Active' },
  { name: 'shop', phase: 'Active' },
  { name: 'kube-system', phase: 'Active' },
];

describe('shell namespace picker', () => {
  it('keeps recent and favorite names in browser storage shape', () => {
    expect(readShellNames(null)).toEqual([]);
    expect(readShellNames('nope')).toEqual([]);
    expect(rememberShellName('["shop"]', 'default')).toEqual(['default', 'shop']);
    expect(rememberShellName('["shop","default"]', 'shop')).toEqual(['shop', 'default']);
    expect(toggleShellName('["shop"]', 'shop')).toEqual([]);
    expect(toggleShellName('[]', 'shop')).toEqual(['shop']);
  });

  it('lists favorites, then recent, then the other matches', () => {
    expect(
      shellNamespaceRows({
        namespaces,
        query: '',
        recent: ['default', 'shop'],
        favorites: ['shop'],
      }).map(row => `${row.section}:${row.name}`)
    ).toEqual(['Favorites:shop', 'Recent:default', 'Namespaces:kube-system']);
    expect(
      shellNamespaceRows({
        namespaces,
        query: 'kube',
        recent: ['shop'],
        favorites: ['shop'],
      }).map(row => row.name)
    ).toEqual(['kube-system']);
  });
});
