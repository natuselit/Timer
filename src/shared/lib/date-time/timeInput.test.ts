import { describe, expect, it } from 'vitest';
import { formatTimeInputDraft, getTimeInputValue, normalizeTimeInput } from './timeInput';

describe('normalizeTimeInput', () => {
  it('доповнює короткий ввід до повного часу', () => {
    expect(normalizeTimeInput('7')).toBe('07:00');
    expect(normalizeTimeInput('14')).toBe('14:00');
  });

  it('розпізнає три або чотири цифри як зручний ручний ввід', () => {
    expect(normalizeTimeInput('630')).toBe('06:30');
    expect(normalizeTimeInput('143')).toBe('14:30');
    expect(normalizeTimeInput('0630')).toBe('06:30');
    expect(normalizeTimeInput('1430')).toBe('14:30');
  });

  it('приймає вставку з двокрапкою та виправляє межі', () => {
    expect(normalizeTimeInput('7:3')).toBe('07:30');
    expect(normalizeTimeInput('24:90')).toBe('23:59');
    expect(normalizeTimeInput('a1b4:3x0')).toBe('14:30');
  });
});

describe('formatTimeInputDraft', () => {
  it('показує проміжну маску без системного time picker', () => {
    expect(formatTimeInputDraft('143')).toBe('14:3');
    expect(formatTimeInputDraft('630')).toBe('6:30');
    expect(formatTimeInputDraft('a1b4:3x0')).toBe('14:30');
  });
});

describe('getTimeInputValue', () => {
  it('бере локальну HH:mm частину ISO-рядка без зміни часового поясу', () => {
    expect(getTimeInputValue('2026-06-10T07:15:00.000+03:00')).toBe('07:15');
  });
});
