import { describe, expect, it } from 'vitest';
import { getImportedMonths, getPrimaryImportedMonth } from './importMonths';

describe('imported schedule months', () => {
  it('keeps every imported month and selects the month with the most records', () => {
    const items = [
      { date: '2026-05-30' },
      { date: '2026-06-01' },
      { date: '2026-06-02' }
    ];

    expect(getImportedMonths(items)).toEqual([
      { year: 2026, month: 5, count: 1, key: '2026-05' },
      { year: 2026, month: 6, count: 2, key: '2026-06' }
    ]);
    expect(getPrimaryImportedMonth(items)).toEqual({ year: 2026, month: 6 });
  });

  it('selects the later month when record counts are equal', () => {
    expect(
      getPrimaryImportedMonth([{ date: '2026-05-30' }, { date: '2026-06-01' }])
    ).toEqual({ year: 2026, month: 6 });
  });

  it('returns null for an empty import', () => {
    expect(getPrimaryImportedMonth([])).toBeNull();
  });
});
