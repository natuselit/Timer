import { describe, expect, it } from 'vitest';
import { formatHourlyRate, formatMoney } from '.';

describe('formatHourlyRate', () => {
  it('візуально округлює ставку до меншого цілого', () => {
    expect(formatHourlyRate(95.652_173_913, false)).toBe('95 ₴/год');
  });

  it('не розкриває ставку в інкогніто', () => {
    expect(formatHourlyRate(95.652_173_913, true)).toBe('🇺🇦');
  });
});

describe('formatMoney', () => {
  it('залишає звичайне форматування грошей без змін', () => {
    expect(formatMoney(95.652_173_913, false)).toBe('96 ₴');
  });

  it('маскує гроші знаком інкогніто', () => {
    expect(formatMoney(95.652_173_913, true)).toBe('🇺🇦');
  });
});
