import type { StatChip, StatSegment } from './StatCard';

export function visibleStatSegments(segments: StatSegment[]): StatSegment[] {
  return segments.filter(segment => Number.isFinite(segment.value) && segment.value > 0);
}

export function visibleStatChips(chips: StatChip[]): StatChip[] {
  return chips.filter(chip => {
    if (chip.value !== undefined) return chip.value > 0;
    const numericPrefix = String(chip.label).match(/^\s*(-?\d+(?:\.\d+)?)(?:\s|$)/);
    return numericPrefix ? Number(numericPrefix[1]) > 0 : true;
  });
}
