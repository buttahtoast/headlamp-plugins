export type Region = {
  id: string;
  city: string;
  canton: string;
  name: string;
  note: string;
  languages: string;
};

export const REGIONS: Region[] = [
  {
    id: 'ch-zrh-1',
    city: 'Zürich',
    canton: 'ZH',
    name: 'Zürich 1',
    note: 'Primary region for commercial estates. Control planes stay in the canton.',
    languages: 'Deutsch',
  },
  {
    id: 'ch-gva-1',
    city: 'Genève',
    canton: 'GE',
    name: 'Genève 1',
    note: 'Western region for international and francophone estates.',
    languages: 'Français',
  },
  {
    id: 'ch-bsl-1',
    city: 'Basel',
    canton: 'BS',
    name: 'Basel 1',
    note: 'Northern region for laboratory and research estates.',
    languages: 'Deutsch',
  },
  {
    id: 'ch-lug-1',
    city: 'Lugano',
    canton: 'TI',
    name: 'Lugano 1',
    note: 'Southern region. Capacity is being commissioned; no estates are scheduled yet.',
    languages: 'Italiano',
  },
];

export function regionById(id: string | null | undefined): Region | undefined {
  if (!id) {
    return undefined;
  }
  return REGIONS.find(region => region.id === id);
}

export const DEFAULT_REGION = '';
